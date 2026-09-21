package progress

import (
	"context"
	"math"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Progress forecasting: when will this learner reach the next level?
//
// This is arithmetic, not a model and certainly not an LLM. A least-squares line is fitted
// to the learner's weekly practice scores and extrapolated to the score that marks the next
// level. Three things follow from choosing something this simple, and all three are the
// point:
//
//   - It can be explained to a learner in one sentence, and the sentence is true.
//   - It can refuse. With three weeks of data, or a flat trend, or a trend going the wrong
//     way, there is no honest forecast, and the endpoint says so instead of inventing a
//     date. A confident wrong date is worse than no date.
//   - Its confidence is the fit's own R², not a number chosen to look reassuring.
//
// Practice content is selected at the learner's current level, so the score is read the
// same way the scoring rules read it: consistently scoring at masteryScore on content at
// your level is what moving up looks like.

const (
	// The score on at-level content that marks readiness for the next level. It matches the
	// top band in assessment/scoring.ruleLevel, so the forecast and the assessment agree
	// about what "a level above" means.
	masteryScore = 85.0

	// Below these there is no trend, only noise.
	minWeeksWithData = 4
	minSessions      = 8

	forecastWeeks = 16

	// A projection further out than this is arithmetic, not a forecast: too much changes in
	// a learner's life over a year for a line through twelve weeks to mean anything.
	maxProjectedWeeks = 52.0
)

type WeekPoint struct {
	WeekStart time.Time `json:"week_start"`
	Sessions  int       `json:"sessions"`
	AvgScore  float64   `json:"avg_score"`
	Minutes   int       `json:"minutes"`
}

type SkillTrend struct {
	Skill string `json:"skill"`
	/** Points per week, from the same fit. Negative means it is going backwards. */
	TrendPerWeek float64 `json:"trend_per_week"`
	AvgScore     float64 `json:"avg_score"`
	Sessions     int     `json:"sessions"`
}

type Forecast struct {
	/** False when there is not enough practice yet to say anything. Reason says why. */
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`

	CurrentLevel *string  `json:"current_level"`
	TargetLevel  *string  `json:"target_level"`
	NextLevel    *string  `json:"next_level"`
	CurrentScore *float64 `json:"current_score"`

	/** Points per week. The whole forecast is this number and the distance left to cover. */
	TrendPerWeek     float64    `json:"trend_per_week"`
	WeeksToNextLevel *float64   `json:"weeks_to_next_level"`
	ProjectedDate    *time.Time `json:"projected_date"`
	/** R² of the fit: how well a straight line actually describes this learner. */
	Confidence float64 `json:"confidence"`

	/** What the projection was computed from, so the learner can see it is not a guess. */
	Weeks          []WeekPoint  `json:"weeks"`
	Skills         []SkillTrend `json:"skills"`
	Sessions       int          `json:"sessions"`
	WeeklySessions float64      `json:"weekly_sessions"`
	Method         string       `json:"method"`
}

func (m *Module) handleForecast(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	out, err := m.Forecast(c.Request.Context(), p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

type weekRow struct {
	week     time.Time
	skill    string
	score    float64
	sessions int
	minutes  int
}

// Forecast projects when the learner reaches the next CEFR level at their current rate.
func (m *Module) Forecast(ctx context.Context, userID uuid.UUID) (Forecast, error) {
	out := Forecast{Weeks: []WeekPoint{}, Skills: []SkillTrend{}, Method: "least_squares_v1"}

	_ = m.pool.QueryRow(ctx, `
		SELECT cl.code, tl.code FROM profiles p
		LEFT JOIN levels cl ON cl.id = p.current_level_id
		LEFT JOIN levels tl ON tl.id = p.target_level_id
		WHERE p.user_id = $1`, userID).Scan(&out.CurrentLevel, &out.TargetLevel)
	if out.CurrentLevel != nil {
		if parsed, err := cefr.Parse(*out.CurrentLevel); err == nil {
			next := parsed.Shift(1).BaseCode()
			out.NextLevel = &next
		}
	}

	rows, err := m.pool.Query(ctx, `
		WITH attempts AS (
			SELECT 'reading' AS skill, score::float8 AS score, time_spent_ms AS ms, created_at
			FROM reading_attempts WHERE user_id = $1 AND mode <> 'placement' AND status = 'completed' AND score IS NOT NULL
			UNION ALL
			SELECT 'listening', score::float8, time_spent_ms, created_at
			FROM listening_attempts WHERE user_id = $1 AND mode <> 'placement' AND status = 'completed' AND score IS NOT NULL
			UNION ALL
			SELECT 'writing', overall_score::float8, time_spent_ms, created_at
			FROM writing_submissions WHERE user_id = $1 AND mode <> 'placement' AND status = 'completed' AND overall_score IS NOT NULL
			UNION ALL
			SELECT 'speaking', overall_score::float8, COALESCE(duration_ms, 0), created_at
			FROM speaking_sessions WHERE user_id = $1 AND mode <> 'placement' AND status = 'completed' AND overall_score IS NOT NULL
		)
		SELECT date_trunc('week', created_at)::date, skill, avg(score)::float8, count(*)::int,
		       (sum(COALESCE(ms, 0)) / 60000)::int
		FROM attempts
		WHERE created_at >= date_trunc('week', now()) - make_interval(weeks => $2)
		GROUP BY 1, 2
		ORDER BY 1`, userID, forecastWeeks)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	var data []weekRow
	for rows.Next() {
		var r weekRow
		if err := rows.Scan(&r.week, &r.skill, &r.score, &r.sessions, &r.minutes); err != nil {
			return out, err
		}
		data = append(data, r)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}

	out.Weeks, out.Skills, out.Sessions = summarize(data)
	if len(out.Weeks) > 0 {
		out.WeeklySessions = round2(float64(out.Sessions) / float64(len(out.Weeks)))
		latest := out.Weeks[len(out.Weeks)-1].AvgScore
		out.CurrentScore = &latest
	}

	if len(out.Weeks) < minWeeksWithData || out.Sessions < minSessions {
		out.Reason = "not_enough_practice"
		return out, nil
	}

	xs := make([]float64, 0, len(out.Weeks))
	ys := make([]float64, 0, len(out.Weeks))
	origin := out.Weeks[0].WeekStart
	for _, w := range out.Weeks {
		xs = append(xs, w.WeekStart.Sub(origin).Hours()/(24*7))
		ys = append(ys, w.AvgScore)
	}
	slope, intercept, r2 := leastSquares(xs, ys)
	out.TrendPerWeek = round2(slope)
	out.Confidence = round2(r2)

	// The fitted value now, not the last week's average: one good week should not move a
	// projection by a month.
	fittedNow := intercept + slope*xs[len(xs)-1]
	current := round2(clamp(fittedNow, 0, 100))
	out.CurrentScore = &current

	switch {
	case current >= masteryScore:
		out.Available = true
		weeks := 0.0
		out.WeeksToNextLevel = &weeks
		date := time.Now().UTC()
		out.ProjectedDate = &date
		out.Reason = "ready_now"
		return out, nil
	case slope <= 0.05:
		// Flat or falling. There is no date to give, and pretending otherwise would be a lie
		// dressed as encouragement.
		out.Reason = "no_upward_trend"
		return out, nil
	}

	weeks := (masteryScore - current) / slope
	if weeks > maxProjectedWeeks {
		out.Reason = "too_far_out"
		return out, nil
	}
	weeks = round2(weeks)
	out.WeeksToNextLevel = &weeks
	date := time.Now().UTC().AddDate(0, 0, int(math.Ceil(weeks*7)))
	out.ProjectedDate = &date
	out.Available = true
	return out, nil
}

// summarize folds per-skill weekly rows into one series per week plus a per-skill trend.
func summarize(data []weekRow) ([]WeekPoint, []SkillTrend, int) {
	type acc struct {
		scoreSum float64
		sessions int
		minutes  int
	}
	byWeek := map[time.Time]*acc{}
	var order []time.Time
	bySkill := map[string][]weekRow{}
	total := 0

	for _, r := range data {
		a, ok := byWeek[r.week]
		if !ok {
			a = &acc{}
			byWeek[r.week] = a
			order = append(order, r.week)
		}
		// Weight each skill's weekly average by how much practice it represents, so a
		// single lucky reading set does not outweigh ten speaking sessions.
		a.scoreSum += r.score * float64(r.sessions)
		a.sessions += r.sessions
		a.minutes += r.minutes
		bySkill[r.skill] = append(bySkill[r.skill], r)
		total += r.sessions
	}

	weeks := make([]WeekPoint, 0, len(order))
	for _, w := range order {
		a := byWeek[w]
		if a.sessions == 0 {
			continue
		}
		weeks = append(weeks, WeekPoint{
			WeekStart: w, Sessions: a.sessions, Minutes: a.minutes,
			AvgScore: round2(a.scoreSum / float64(a.sessions)),
		})
	}

	skills := make([]SkillTrend, 0, len(bySkill))
	for _, code := range []string{"reading", "listening", "writing", "speaking"} {
		rows, ok := bySkill[code]
		if !ok {
			continue
		}
		t := SkillTrend{Skill: code}
		var xs, ys []float64
		var sum float64
		origin := rows[0].week
		for _, r := range rows {
			xs = append(xs, r.week.Sub(origin).Hours()/(24*7))
			ys = append(ys, r.score)
			sum += r.score * float64(r.sessions)
			t.Sessions += r.sessions
		}
		if t.Sessions > 0 {
			t.AvgScore = round2(sum / float64(t.Sessions))
		}
		if len(xs) >= 2 {
			slope, _, _ := leastSquares(xs, ys)
			t.TrendPerWeek = round2(slope)
		}
		skills = append(skills, t)
	}
	return weeks, skills, total
}

// leastSquares fits y = intercept + slope*x and reports the coefficient of determination.
// A series with no variation in x, or none in y, has no meaningful fit and reports zero.
func leastSquares(xs, ys []float64) (slope, intercept, r2 float64) {
	n := float64(len(xs))
	if n < 2 {
		return 0, 0, 0
	}
	var sumX, sumY float64
	for i := range xs {
		sumX += xs[i]
		sumY += ys[i]
	}
	meanX, meanY := sumX/n, sumY/n

	var sxx, sxy, syy float64
	for i := range xs {
		dx, dy := xs[i]-meanX, ys[i]-meanY
		sxx += dx * dx
		sxy += dx * dy
		syy += dy * dy
	}
	if sxx == 0 {
		return 0, meanY, 0
	}
	slope = sxy / sxx
	intercept = meanY - slope*meanX
	if syy == 0 {
		return slope, intercept, 0
	}
	r2 = clamp((sxy*sxy)/(sxx*syy), 0, 1)
	return slope, intercept, r2
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func round2(v float64) float64 { return math.Round(v*100) / 100 }
