package vocabulary

import (
	"context"
	"errors"
	"math/rand/v2"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Irregular verbs: the table, and practice on it.
//
// The list is curated (migration 000037), not generated. A learner reads it grouped by how the
// forms change, and practises by typing the two forms they do not see; every answer is kept,
// so the verbs they get wrong come back first and make up "my mistakes".

// knownStreak is how many right answers in a row make a verb count as known.
const knownStreak = 3

// IrregularVerb is one verb with where the learner stands with it.
type IrregularVerb struct {
	ID             uuid.UUID         `json:"id"`
	Base           string            `json:"base"`
	Past           string            `json:"past"`
	PastParticiple string            `json:"past_participle"`
	Pattern        string            `json:"pattern"`
	Level          string            `json:"level"`
	Uz             string            `json:"uz"`
	Ru             string            `json:"ru"`
	Note           string            `json:"note"`
	Examples       map[string]string `json:"examples"`
	/** never | learning | mistake | known: the learner's state with this verb. */
	State   string `json:"state"`
	Correct int    `json:"correct"`
	Wrong   int    `json:"wrong"`
}

type irregularSummary struct {
	Total     int `json:"total"`
	Practiced int `json:"practiced"`
	Known     int `json:"known"`
	Mistakes  int `json:"mistakes"`
}

type irregularPage struct {
	Items   []IrregularVerb  `json:"items"`
	Summary irregularSummary `json:"summary"`
	Levels  []Facet          `json:"levels"`
}

type irregularQuery struct {
	Search  string `form:"q" binding:"omitempty,max=40"`
	Level   string `form:"level" binding:"omitempty,oneof=A1 A2 B1 B2 C1 C2"`
	Pattern string `form:"pattern" binding:"omitempty,oneof=AAA ABB ABA ABC"`
	/** mistakes: got wrong and not yet put right; known: three right in a row. */
	Show string `form:"show" binding:"omitempty,oneof=mistakes known new"`
}

const verbColumns = `
	v.id, v.base, v.past, v.past_participle, v.pattern, v.level_code, v.uz, v.ru, v.note, v.examples,
	COALESCE(u.correct, 0), COALESCE(u.wrong, 0), COALESCE(u.streak, 0), u.verb_id IS NOT NULL`

const verbFrom = ` FROM irregular_verbs v LEFT JOIN user_irregular_verbs u ON u.verb_id = v.id AND u.user_id = $1 `

func scanVerb(row pgx.Row) (IrregularVerb, error) {
	var v IrregularVerb
	var streak int
	var practiced bool
	if err := row.Scan(&v.ID, &v.Base, &v.Past, &v.PastParticiple, &v.Pattern, &v.Level, &v.Uz, &v.Ru, &v.Note,
		&v.Examples, &v.Correct, &v.Wrong, &streak, &practiced); err != nil {
		return v, err
	}
	v.State = verbState(practiced, v.Wrong, streak)
	if v.Examples == nil {
		v.Examples = map[string]string{}
	}
	return v, nil
}

func verbState(practiced bool, wrong, streak int) string {
	switch {
	case !practiced:
		return "never"
	case streak >= knownStreak:
		return "known"
	case wrong > 0 && streak == 0:
		return "mistake"
	default:
		return "learning"
	}
}

// GET /vocabulary/irregular-verbs — the whole table, filtered, with the learner's progress.
func (m *Module) irregularVerbs(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var q irregularQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	where := `WHERE ($2 = '' OR v.base ILIKE $2 || '%' OR v.past ILIKE '%' || $2 || '%' OR v.past_participle ILIKE '%' || $2 || '%'
	                 OR v.uz ILIKE '%' || $2 || '%' OR v.ru ILIKE '%' || $2 || '%')
	            AND ($3 = '' OR v.level_code = $3)
	            AND ($4 = '' OR v.pattern = $4)
	            AND (CASE $5 WHEN 'mistakes' THEN u.wrong > 0 AND u.streak = 0
	                         WHEN 'known' THEN u.streak >= 3
	                         WHEN 'new' THEN u.verb_id IS NULL
	                         ELSE TRUE END)`
	rows, err := m.pool.Query(ctx, `SELECT `+verbColumns+verbFrom+where+`
		ORDER BY array_position(ARRAY['A1','A2','B1','B2','C1','C2'], v.level_code), v.base`,
		p.UserID, strings.TrimSpace(q.Search), q.Level, q.Pattern, q.Show)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	out := irregularPage{Items: []IrregularVerb{}, Levels: []Facet{}}
	for rows.Next() {
		v, err := scanVerb(rows)
		if err != nil {
			rows.Close()
			httpx.Fail(c, err)
			return
		}
		out.Items = append(out.Items, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.pool.QueryRow(ctx, `
		SELECT count(*)::int, count(u.verb_id)::int,
		       count(*) FILTER (WHERE u.streak >= 3)::int,
		       count(*) FILTER (WHERE u.wrong > 0 AND u.streak = 0)::int`+verbFrom, p.UserID,
	).Scan(&out.Summary.Total, &out.Summary.Practiced, &out.Summary.Known, &out.Summary.Mistakes); err != nil {
		httpx.Fail(c, err)
		return
	}
	levels, err := m.pool.Query(ctx, `SELECT level_code, count(*)::int FROM irregular_verbs GROUP BY 1 ORDER BY 1`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	for levels.Next() {
		var f Facet
		if err := levels.Scan(&f.Value, &f.Count); err != nil {
			levels.Close()
			httpx.Fail(c, err)
			return
		}
		out.Levels = append(out.Levels, f)
	}
	levels.Close()
	m.backfillVerbExamples(ctx)
	httpx.OK(c, out)
}

type practiceQuery struct {
	irregularQuery
	Count int `form:"count" binding:"omitempty,min=5,max=40"`
}

// GET /vocabulary/irregular-verbs/practice — a round of verbs to practise from the filtered
// table: the learner's mistakes first, then verbs they have not met, then the rest, shuffled
// within each group so no two rounds start the same.
func (m *Module) irregularPractice(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var q practiceQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	if q.Count == 0 {
		q.Count = 10
	}
	rows, err := m.pool.Query(c.Request.Context(), `SELECT `+verbColumns+verbFrom+`
		WHERE ($2 = '' OR v.level_code = $2) AND ($3 = '' OR v.pattern = $3)
		  AND ($4 <> 'mistakes' OR (u.wrong > 0 AND u.streak = 0))`, p.UserID, q.Level, q.Pattern, q.Show)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()
	groups := map[string][]IrregularVerb{}
	for rows.Next() {
		v, err := scanVerb(rows)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		groups[v.State] = append(groups[v.State], v)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	out := []IrregularVerb{}
	for _, state := range []string{"mistake", "never", "learning", "known"} {
		g := groups[state]
		rand.Shuffle(len(g), func(i, j int) { g[i], g[j] = g[j], g[i] })
		out = append(out, g...)
	}
	if len(out) > q.Count {
		out = out[:q.Count]
	}
	rand.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	httpx.OK(c, map[string]any{"items": out})
}

type verbAnswer struct {
	Past       string `json:"past" binding:"max=60"`
	Participle string `json:"past_participle" binding:"max=60"`
}

// VerbCheck is one answer, marked.
type VerbCheck struct {
	PastRight       bool   `json:"past_right"`
	ParticipleRight bool   `json:"past_participle_right"`
	Correct         bool   `json:"correct"`
	Past            string `json:"past"`
	PastParticiple  string `json:"past_participle"`
	State           string `json:"state"`
}

// AcceptsForm reports whether an answer is one of a form's accepted spellings: "learnt /
// learned" takes either, "was / were" takes either, and the whole "was / were" as well.
func AcceptsForm(form, answer string) bool {
	norm := func(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), " ") }
	answer = norm(strings.ReplaceAll(answer, "’", "'"))
	if answer == "" {
		return false
	}
	if answer == norm(form) || strings.ReplaceAll(answer, " ", "") == strings.ReplaceAll(norm(form), " ", "") {
		return true
	}
	return slices.ContainsFunc(strings.Split(form, "/"), func(v string) bool { return norm(v) == answer })
}

// POST /vocabulary/irregular-verbs/:id/answer — mark the two forms the learner typed and keep
// the result: a right answer extends the streak, a wrong one resets it.
func (m *Module) irregularAnswer(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid verb id"))
		return
	}
	var in verbAnswer
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	var out VerbCheck
	err = m.pool.QueryRow(ctx, `SELECT past, past_participle FROM irregular_verbs WHERE id = $1`, id).Scan(&out.Past, &out.PastParticiple)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Verb"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	out.PastRight = AcceptsForm(out.Past, in.Past)
	out.ParticipleRight = AcceptsForm(out.PastParticiple, in.Participle)
	out.Correct = out.PastRight && out.ParticipleRight
	right := 0
	if out.Correct {
		right = 1
	}
	var wrong, streak int
	if err := m.pool.QueryRow(ctx, `
		INSERT INTO user_irregular_verbs (user_id, verb_id, correct, wrong, streak, last_wrong, practiced_at)
		VALUES ($1, $2, $3, 1 - $3, $3, CASE WHEN $3 = 0 THEN jsonb_build_object('past', $4::text, 'past_participle', $5::text) END, now())
		ON CONFLICT (user_id, verb_id) DO UPDATE SET
		    correct = user_irregular_verbs.correct + $3,
		    wrong = user_irregular_verbs.wrong + 1 - $3,
		    streak = CASE WHEN $3 = 1 THEN user_irregular_verbs.streak + 1 ELSE 0 END,
		    last_wrong = CASE WHEN $3 = 0 THEN EXCLUDED.last_wrong ELSE user_irregular_verbs.last_wrong END,
		    practiced_at = now()
		RETURNING wrong, streak`, p.UserID, id, right, in.Past, in.Participle).Scan(&wrong, &streak); err != nil {
		httpx.Fail(c, err)
		return
	}
	out.State = verbState(true, wrong, streak)
	httpx.OK(c, out)
}

// backfillVerbExamples writes, in the background, example sentences for verbs that have none,
// a batch at a time. The table is answered at once; the sentences are there the next time.
func (m *Module) backfillVerbExamples(ctx context.Context) {
	if m.ai == nil {
		return
	}
	rows, err := m.pool.Query(ctx, `SELECT base, past, past_participle FROM irregular_verbs WHERE examples = '{}'::jsonb ORDER BY base LIMIT 25`)
	if err != nil {
		return
	}
	var todo []ai.VerbForms
	for rows.Next() {
		var v ai.VerbForms
		if rows.Scan(&v.Base, &v.Past, &v.Participle) == nil {
			todo = append(todo, v)
		}
	}
	rows.Close()
	if len(todo) == 0 {
		return
	}
	if m.redis != nil {
		if ok, err := m.redis.SetNX(ctx, "vocabulary:verb-examples", 1, 90*time.Second).Result(); err == nil && !ok {
			return
		}
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 80*time.Second)
		defer cancel()
		if m.redis != nil {
			defer m.redis.Del(ctx, "vocabulary:verb-examples")
		}
		got, err := m.ai.WriteVerbExamples(ctx, todo)
		if err != nil {
			m.warn("vocabulary: writing verb examples failed", "count", len(todo), "error", err.Error())
			return
		}
		for base, ex := range got {
			if _, err := m.pool.Exec(ctx, `UPDATE irregular_verbs SET examples = jsonb_build_object('base', $2::text, 'past', $3::text, 'participle', $4::text) WHERE base = $1`,
				base, ex["base"], ex["past"], ex["participle"]); err != nil {
				m.warn("vocabulary: storing verb examples failed", "verb", base, "error", err.Error())
			}
		}
	}()
}
