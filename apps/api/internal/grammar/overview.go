package grammar

import (
	"context"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Analytics events. They are emitted by the server, where the thing actually happens, so
// web and the future mobile apps report the same funnel without agreeing on anything.
const (
	EventTopicOpened       = "grammar_topic_opened"
	EventSearch            = "grammar_search"
	EventAIExplain         = "grammar_ai_explain_requested"
	EventAITutor           = "grammar_ai_tutor_opened"
	EventAIVisual          = "grammar_visual_requested"
	EventPracticeStarted   = "grammar_practice_started"
	EventQuestionAnswered  = "grammar_question_answered"
	EventPracticeCompleted = "grammar_practice_completed"
	EventTopicMastered     = "grammar_topic_mastered"
)

func (m *Module) track(ctx context.Context, userID uuid.UUID, name string, props map[string]any) {
	if m.tracker == nil {
		return
	}
	m.tracker.Track(ctx, analytics.Server(name, userID, props))
}

// Suggestion is one recommended thing to do, with the reason it is being recommended.
// A recommendation without a reason is a guess the learner has to trust; with one, it is
// an observation they can check.
type Suggestion struct {
	Kind      string  `json:"kind"` // practice_rule | compare | continue | weak | start
	Topic     string  `json:"topic"`
	TopicName string  `json:"topic_name"`
	Rule      string  `json:"rule,omitempty"`
	Label     string  `json:"label"`
	Reason    string  `json:"reason"`
	Mastery   float64 `json:"mastery"`
	Priority  int     `json:"priority"`
}

// Overview is the grammar home page's learner-specific half.
type Overview struct {
	Recommended []Suggestion   `json:"recommended"`
	Continue    []TopicSummary `json:"continue"`
	Weak        []TopicSummary `json:"weak"`
	Summary     OverviewStats  `json:"summary"`
}

type OverviewStats struct {
	TopicsTotal    int     `json:"topics_total"`
	TopicsStarted  int     `json:"topics_started"`
	TopicsMastered int     `json:"topics_mastered"`
	OverallMastery float64 `json:"overall_mastery"`
}

// GET /grammar/overview — "For you", "Continue learning" and "Weak grammar".
//
// The recommendations come from the same evidence the AI Coach uses: recurring errors first,
// because a mistake the learner keeps making is the most useful thing they could fix today.
func (m *Module) overview(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	out := Overview{Recommended: []Suggestion{}, Continue: []TopicSummary{}, Weak: []TopicSummary{}}

	if err := m.pool.QueryRow(ctx, `
		SELECT count(*)::int,
		       count(p.user_id) FILTER (WHERE p.state NOT IN ('not_started'))::int,
		       count(p.user_id) FILTER (WHERE p.state = 'mastered')::int,
		       COALESCE(avg(COALESCE(p.mastery, 0)), 0)::float8
		FROM grammar_topics t
		LEFT JOIN user_grammar_progress p ON p.grammar_topic_id = t.id AND p.user_id = $1
		WHERE t.status = 'published'`, p.UserID).
		Scan(&out.Summary.TopicsTotal, &out.Summary.TopicsStarted, &out.Summary.TopicsMastered,
			&out.Summary.OverallMastery); err != nil {
		httpx.Fail(c, err)
		return
	}
	out.Summary.OverallMastery = round2(out.Summary.OverallMastery)

	// 1. Rules with recurring errors: the most specific, most actionable recommendation.
	errorRows, err := m.pool.Query(ctx, `
		SELECT t.slug, t.name, e.target_rule, e.occurrences, e.severity_score::float8,
		       COALESCE(p.mastery, 0)::float8
		FROM grammar_user_errors e
		JOIN grammar_topics t ON t.id = e.grammar_topic_id AND t.status = 'published'
		LEFT JOIN user_grammar_progress p ON p.grammar_topic_id = t.id AND p.user_id = $1
		WHERE e.user_id = $1 AND e.occurrences >= 2
		ORDER BY e.severity_score DESC, e.last_seen_at DESC
		LIMIT 3`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer errorRows.Close()
	for errorRows.Next() {
		var s Suggestion
		var occurrences int
		var severity float64
		if err := errorRows.Scan(&s.Topic, &s.TopicName, &s.Rule, &occurrences, &severity, &s.Mastery); err != nil {
			httpx.Fail(c, err)
			return
		}
		s.Kind = "practice_rule"
		s.Label = fmt.Sprintf("%s — %s", s.TopicName, humanizeRule(s.Rule))
		s.Reason = fmt.Sprintf("You made %d errors with this recently", occurrences)
		s.Priority = int(severity)
		out.Recommended = append(out.Recommended, s)
	}
	if err := errorRows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	// 2. Pairs the learner confuses: two topics they half know that are commonly mixed up.
	confusedRows, err := m.pool.Query(ctx, `
		SELECT a.slug, a.name, b.slug, b.name
		FROM grammar_relations r
		JOIN grammar_topics a ON a.id = r.from_topic_id AND a.status = 'published'
		JOIN grammar_topics b ON b.id = r.to_topic_id AND b.status = 'published'
		JOIN user_grammar_progress pa ON pa.grammar_topic_id = a.id AND pa.user_id = $1
		LEFT JOIN user_grammar_progress pb ON pb.grammar_topic_id = b.id AND pb.user_id = $1
		WHERE r.kind IN ('compare', 'commonly_confused')
		  AND pa.mastery BETWEEN 20 AND 79
		  AND COALESCE(pb.mastery, 0) < 80
		ORDER BY pa.mastery
		LIMIT 2`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer confusedRows.Close()
	for confusedRows.Next() {
		var leftSlug, leftName, rightSlug, rightName string
		if err := confusedRows.Scan(&leftSlug, &leftName, &rightSlug, &rightName); err != nil {
			httpx.Fail(c, err)
			return
		}
		out.Recommended = append(out.Recommended, Suggestion{
			Kind: "compare", Topic: leftSlug, TopicName: leftName, Rule: rightSlug,
			Label:    fmt.Sprintf("%s vs %s", leftName, rightName),
			Reason:   "These two are easy to mix up, and you are still building both",
			Priority: 40,
		})
	}
	if err := confusedRows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	// 3. Nothing to fix yet: suggest where to start, at their level.
	if len(out.Recommended) == 0 {
		startRows, err := m.pool.Query(ctx, `SELECT `+topicColumns+topicJoins+`
			WHERE t.status = 'published' AND COALESCE(p.state, 'not_started') = 'not_started'
			ORDER BY t.difficulty, c.sort_order, t.sort_order
			LIMIT 3`, p.UserID)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		defer startRows.Close()
		starters, err := collectTopics(startRows)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		for _, t := range starters {
			out.Recommended = append(out.Recommended, Suggestion{
				Kind: "start", Topic: t.Slug, TopicName: t.Name, Label: t.Name,
				Reason: "A good place to start", Priority: 20,
			})
		}
	}

	// Continue learning: started, not finished, most recently touched first.
	continueRows, err := m.pool.Query(ctx, `SELECT `+topicColumns+topicJoins+`
		WHERE t.status = 'published' AND p.state IN ('learning', 'practicing', 'developing')
		ORDER BY p.last_practiced_at DESC NULLS LAST, p.opened_at DESC NULLS LAST
		LIMIT 4`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer continueRows.Close()
	if out.Continue, err = collectTopics(continueRows); err != nil {
		httpx.Fail(c, err)
		return
	}

	// Weak grammar: practised, still low. A topic never practised is not weak, it is new.
	weakRows, err := m.pool.Query(ctx, `SELECT `+topicColumns+topicJoins+`
		WHERE t.status = 'published' AND p.attempts > 0 AND p.mastery < 50
		ORDER BY p.mastery
		LIMIT 4`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer weakRows.Close()
	if out.Weak, err = collectTopics(weakRows); err != nil {
		httpx.Fail(c, err)
		return
	}

	httpx.OK(c, out)
}

// CategoryProgress is grammar's contribution to the Progress page.
type CategoryProgress struct {
	Slug     string  `json:"slug"`
	Name     string  `json:"name"`
	Mastery  float64 `json:"mastery"`
	Total    int     `json:"total"`
	Started  int     `json:"started"`
	Mastered int     `json:"mastered"`
}

type ProgressOverview struct {
	Overall    float64            `json:"overall"`
	Categories []CategoryProgress `json:"categories"`
	Stats      OverviewStats      `json:"stats"`
	Weakest    []TopicSummary     `json:"weakest"`
}

// GET /grammar/progress — per-category mastery for the Progress page. Grammar reports into
// the existing progress architecture rather than keeping a progress system of its own.
func (m *Module) progress(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	ctx := c.Request.Context()

	out := ProgressOverview{Categories: []CategoryProgress{}, Weakest: []TopicSummary{}}
	rows, err := m.pool.Query(ctx, `
		SELECT cat.slug, cat.name,
		       COALESCE(avg(COALESCE(pr.mastery, 0)), 0)::float8,
		       count(t.id)::int,
		       count(pr.user_id) FILTER (WHERE pr.state <> 'not_started')::int,
		       count(pr.user_id) FILTER (WHERE pr.state = 'mastered')::int
		FROM grammar_categories cat
		JOIN grammar_topics t ON t.category_id = cat.id AND t.status = 'published'
		LEFT JOIN user_grammar_progress pr ON pr.grammar_topic_id = t.id AND pr.user_id = $1
		WHERE cat.status = 'published'
		GROUP BY cat.id
		ORDER BY cat.sort_order`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	var sum float64
	for rows.Next() {
		var cp CategoryProgress
		if err := rows.Scan(&cp.Slug, &cp.Name, &cp.Mastery, &cp.Total, &cp.Started, &cp.Mastered); err != nil {
			httpx.Fail(c, err)
			return
		}
		cp.Mastery = round2(cp.Mastery)
		sum += cp.Mastery
		out.Categories = append(out.Categories, cp)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	if len(out.Categories) > 0 {
		out.Overall = round2(sum / float64(len(out.Categories)))
	}

	if err := m.pool.QueryRow(ctx, `
		SELECT count(*)::int,
		       count(p.user_id) FILTER (WHERE p.state <> 'not_started')::int,
		       count(p.user_id) FILTER (WHERE p.state = 'mastered')::int,
		       COALESCE(avg(COALESCE(p.mastery, 0)), 0)::float8
		FROM grammar_topics t
		LEFT JOIN user_grammar_progress p ON p.grammar_topic_id = t.id AND p.user_id = $1
		WHERE t.status = 'published'`, p.UserID).
		Scan(&out.Stats.TopicsTotal, &out.Stats.TopicsStarted, &out.Stats.TopicsMastered,
			&out.Stats.OverallMastery); err != nil {
		httpx.Fail(c, err)
		return
	}
	out.Stats.OverallMastery = round2(out.Stats.OverallMastery)

	weakRows, err := m.pool.Query(ctx, `SELECT `+topicColumns+topicJoins+`
		WHERE t.status = 'published' AND p.attempts > 0
		ORDER BY p.mastery LIMIT 5`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer weakRows.Close()
	if out.Weakest, err = collectTopics(weakRows); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}
