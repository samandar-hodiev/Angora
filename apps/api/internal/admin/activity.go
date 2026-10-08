package admin

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Team activity: what the people running the console did to the content, and how.
//
// The audit log answers "who signed in, from where". This answers "who wrote what": every
// change to grammar, vocabulary, phrases, collocations and irregular verbs, whether the AI
// wrote it or a person did, and what was regenerated, published or deleted. It reads the
// same audit_logs table — content changes are recorded there with the area, the method and
// the thing that changed — so there is one record of what happened, read two ways.

// Content actions on the lexicon and the verb table. Grammar keeps its own action names.
const (
	ActionLexiconCreated   = "lexicon.created"
	ActionLexiconEdited    = "lexicon.edited"
	ActionLexiconGenerated = "lexicon.generated"
	ActionLexiconPublished = "lexicon.published"
	ActionLexiconArchived  = "lexicon.archived"
	ActionLexiconStatus    = "lexicon.status_changed"
)

// lexiconArea names a lexicon kind the way the console's sidebar does.
func lexiconArea(kind string) string {
	switch kind {
	case "phrase":
		return "phrases"
	case "collocation":
		return "collocations"
	case "irregular_verb":
		return "irregular_verbs"
	default:
		return "vocabulary"
	}
}

// recordContent writes one content change to the audit log. Best-effort, like every audit
// write: a lost entry never fails the owner's request.
func (m *Module) recordContent(c *gin.Context, action, area, method, target string, count int, extra map[string]any) {
	if m.audit == nil {
		return
	}
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		return
	}
	meta := map[string]any{"area": area, "method": method, "target": target}
	if count > 0 {
		meta["count"] = count
	}
	for k, v := range extra {
		meta[k] = v
	}
	actor := p.UserID
	m.audit.Record(c.Request.Context(), audit.Entry{
		ActorID: &actor, Action: action, EntityType: area, EntityID: target, Metadata: meta,
		IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
	})
}

// recordWordChange records what a single-word endpoint just did, from the route it was.
func (m *Module) recordWordChange(c *gin.Context, area, target, status string) {
	path := c.FullPath()
	switch {
	case c.Request.Method == http.MethodPost && strings.HasSuffix(path, "/status"):
		action := ActionLexiconStatus
		switch status {
		case "published":
			action = ActionLexiconPublished
		case "archived":
			action = ActionLexiconArchived
		}
		m.recordContent(c, action, area, "manual", target, 1, map[string]any{"status": status})
	case c.Request.Method == http.MethodPost && !strings.Contains(path, ":id"):
		m.recordContent(c, ActionLexiconCreated, area, "manual", target, 1, nil)
	default:
		m.recordContent(c, ActionLexiconEdited, area, "manual", target, 1, nil)
	}
}

// ---- the report -------------------------------------------------------------------------

type activityQuery struct {
	Days  int    `form:"days" binding:"omitempty,oneof=1 7 30 90"`
	Actor string `form:"actor" binding:"omitempty,uuid"`
	Area  string `form:"area" binding:"omitempty,max=40"`
}

type ActivityPerson struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	AvatarURL *string   `json:"avatar_url"`
}

type ActivityCounts struct {
	Total       int `json:"total"`
	AI          int `json:"ai"`
	Manual      int `json:"manual"`
	Regenerated int `json:"regenerated"`
	Published   int `json:"published"`
	Deleted     int `json:"deleted"`
}

type ActivityWorker struct {
	ActivityPerson
	ActivityCounts
	LastAt time.Time `json:"last_at"`
}

type ActivityEvent struct {
	At     time.Time      `json:"at"`
	Actor  ActivityPerson `json:"actor"`
	Area   string         `json:"area"`
	Kind   string         `json:"kind"`
	Method string         `json:"method"`
	Target string         `json:"target"`
	Count  int            `json:"count"`
	Detail string         `json:"detail"`
}

type ActivityReport struct {
	Days    int                       `json:"days"`
	Workers []ActivityWorker          `json:"workers"`
	ByArea  map[string]ActivityCounts `json:"by_area"`
	Events  []ActivityEvent           `json:"events"`
}

// classify reads an audit row as a content change: which area, what kind, AI or by hand.
func classify(action string, meta map[string]any) (area, kind, method string, ok bool) {
	str := func(k string) string { s, _ := meta[k].(string); return s }
	switch {
	case strings.HasPrefix(action, "grammar_content.") || strings.HasPrefix(action, "grammar_topic."):
		area = "grammar"
		switch action {
		case ActionGrammarGenerated:
			kind, method = "generated", "ai"
		case ActionGrammarRefined:
			kind, method = "regenerated", "ai"
			if a := str("action"); a != "" && a != "regenerate" && a != "regenerate_item" {
				kind = "improved"
			}
		case ActionGrammarTranslated:
			kind, method = "translated", "ai"
		case ActionGrammarContentSaved, ActionGrammarUpdated:
			kind, method = "edited", "manual"
		case ActionGrammarPublished:
			kind, method = "published", "manual"
		case ActionGrammarContentDeleted:
			kind, method = "deleted", "manual"
		case ActionGrammarStatusChanged:
			kind, method = "status_changed", "manual"
		default:
			return "", "", "", false
		}
		return area, kind, method, true
	case strings.HasPrefix(action, "lexicon."):
		area, method = str("area"), str("method")
		kind = strings.TrimPrefix(action, "lexicon.")
		return area, kind, method, area != ""
	}
	return "", "", "", false
}

// GET /admin/activity?days=&actor=&area=
func (m *Module) activityReport(c *gin.Context) {
	var q activityQuery
	if err := httpx.BindQuery(c, &q); err != nil {
		httpx.Fail(c, err)
		return
	}
	if q.Days == 0 {
		q.Days = 30
	}
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT a.created_at, a.action, a.entity_id, a.metadata,
		       u.id, u.email, u.role, COALESCE(NULLIF(p.display_name, ''), NULLIF(trim(p.first_name || ' ' || p.last_name), ''), u.email),
		       p.avatar_url
		FROM audit_logs a
		JOIN users u ON u.id = a.actor_id
		LEFT JOIN profiles p ON p.user_id = u.id
		WHERE a.created_at > now() - make_interval(days => $1::int)
		  AND (a.action LIKE 'grammar_content.%' OR a.action LIKE 'grammar_topic.%' OR a.action LIKE 'lexicon.%')
		  AND ($2 = '' OR u.id::text = $2)
		ORDER BY a.created_at DESC
		LIMIT 2000`, q.Days, q.Actor)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	report := ActivityReport{Days: q.Days, Workers: []ActivityWorker{}, ByArea: map[string]ActivityCounts{}, Events: []ActivityEvent{}}
	workers := map[uuid.UUID]*ActivityWorker{}
	topicNames := map[string]string{}
	for rows.Next() {
		var at time.Time
		var action, entity string
		var raw []byte
		var person ActivityPerson
		if err := rows.Scan(&at, &action, &entity, &raw, &person.ID, &person.Email, &person.Role, &person.Name, &person.AvatarURL); err != nil {
			httpx.Fail(c, err)
			return
		}
		meta := map[string]any{}
		_ = json.Unmarshal(raw, &meta)
		area, kind, method, ok := classify(action, meta)
		if !ok || (q.Area != "" && area != q.Area) {
			continue
		}
		count := 1
		if n, ok := meta["count"].(float64); ok && n > 0 {
			count = int(n)
		}
		target, _ := meta["target"].(string)
		if target == "" {
			target = entity
			if area == "grammar" {
				topicNames[entity] = ""
			}
		}
		report.Events = append(report.Events, ActivityEvent{
			At: at, Actor: person, Area: area, Kind: kind, Method: method, Target: target, Count: count,
			Detail: activityDetail(kind, meta),
		})

		w := workers[person.ID]
		if w == nil {
			w = &ActivityWorker{ActivityPerson: person, LastAt: at}
			workers[person.ID] = w
		}
		tally(&w.ActivityCounts, kind, method)
		a := report.ByArea[area]
		tally(&a, kind, method)
		report.ByArea[area] = a
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}

	// Grammar entries carry the topic's slug; show its name.
	if len(topicNames) > 0 {
		slugs := make([]string, 0, len(topicNames))
		for s := range topicNames {
			slugs = append(slugs, s)
		}
		nameRows, err := m.pool.Query(c.Request.Context(), `SELECT slug, name FROM grammar_topics WHERE slug = ANY($1)`, slugs)
		if err == nil {
			for nameRows.Next() {
				var slug, name string
				if nameRows.Scan(&slug, &name) == nil {
					topicNames[slug] = name
				}
			}
			nameRows.Close()
		}
		for i := range report.Events {
			if name := topicNames[report.Events[i].Target]; report.Events[i].Area == "grammar" && name != "" {
				report.Events[i].Target = name
			}
		}
	}

	for _, w := range workers {
		report.Workers = append(report.Workers, *w)
	}
	sort.Slice(report.Workers, func(i, j int) bool { return report.Workers[i].Total > report.Workers[j].Total })
	if len(report.Events) > 300 {
		report.Events = report.Events[:300]
	}
	httpx.OK(c, report)
}

func tally(c *ActivityCounts, kind, method string) {
	c.Total++
	switch {
	case kind == "regenerated" || kind == "improved":
		c.Regenerated++
		c.AI++
	case method == "ai":
		c.AI++
	default:
		c.Manual++
	}
	switch kind {
	case "published":
		c.Published++
	case "deleted":
		c.Deleted++
	}
}

// activityDetail is the one line under an event: which levels, languages or parts.
func activityDetail(kind string, meta map[string]any) string {
	list := func(k string) string {
		items, _ := meta[k].([]any)
		parts := make([]string, 0, len(items))
		for _, it := range items {
			if s, ok := it.(string); ok {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, ", ")
	}
	var bits []string
	if s := list("parts"); s != "" {
		bits = append(bits, s)
	}
	if s := list("levels"); s != "" {
		bits = append(bits, s)
	}
	if s := list("languages"); s != "" {
		bits = append(bits, s)
	}
	if s, _ := meta["section"].(string); s != "" {
		bits = append(bits, "section: "+s)
	}
	if s, _ := meta["level"].(string); s != "" {
		bits = append(bits, s)
	}
	return strings.Join(bits, " · ")
}
