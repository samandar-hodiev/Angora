// Package grammar is Engora's grammar learning system: a curated curriculum, canonical
// explanations, relationships between topics, a practice engine, mastery and the AI
// features built on top of them.
//
//	Library (categories → topics)
//	    → Topic (canonical content, relations, comparisons)
//	        → AI explanation / tutor / visual   (cached, rate limited)
//	        → Practice (deterministic scoring; AI only for free text)
//	            → Mastery (understanding + practice + application)
//	                → Weaknesses → mistakes/weaknesses → AI Coach, Progress
//
// Two rules shape the package:
//
//  1. Canonical grammar content is curated product content. AI never writes what a learner
//     reads as the rule; it explains, rephrases, questions and illustrates around it.
//  2. Anything scoreable in Go is scored in Go. AI is reserved for free text, tutoring,
//     explanation and visuals, and every one of those is cached or rate limited.
package grammar

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/ratelimit"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// ContentSchemaVersion is the shape of grammar_content.body this build understands.
const ContentSchemaVersion = 1

// Relation kinds. They mirror the grammar_relations CHECK constraint.
const (
	RelPrerequisite     = "prerequisite"
	RelRelated          = "related"
	RelCompare          = "compare"
	RelNext             = "next"
	RelAlternative      = "alternative"
	RelCommonlyConfused = "commonly_confused"
)

// Mastery states, weakest to strongest.
const (
	StateNotStarted = "not_started"
	StateLearning   = "learning"
	StatePracticing = "practicing"
	StateDeveloping = "developing"
	StateMastered   = "mastered"
)

// Category is a folder in the grammar library.
type Category struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
	TopicCount  int    `json:"topic_count"`
	// Learner-specific counts; zero for every category when unauthenticated.
	StartedCount  int      `json:"started_count"`
	MasteredCount int      `json:"mastered_count"`
	Mastery       float64  `json:"mastery"`
	Levels        []string `json:"levels"`
}

// TopicSummary is a topic as it appears in lists, search results and relation links.
type TopicSummary struct {
	Slug             string   `json:"slug"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Category         string   `json:"category"`
	CategoryName     string   `json:"category_name"`
	Group            string   `json:"group"`
	Level            *string  `json:"level"`
	CEFRLevels       []string `json:"cefr_levels"`
	Difficulty       float64  `json:"difficulty"`
	IELTSRelevant    bool     `json:"ielts_relevant"`
	EstimatedMinutes int      `json:"estimated_minutes"`
	HasPractice      bool     `json:"has_practice"`

	// Learner progress. Mastery is 0 and State "not_started" until they touch the topic.
	Mastery         float64    `json:"mastery"`
	State           string     `json:"state"`
	Attempts        int        `json:"attempts"`
	LastPracticedAt *time.Time `json:"last_practiced_at"`
}

// Formula is one pattern of a topic ("Affirmative: Subject + V2") with its examples.
type Formula struct {
	Label    string   `json:"label"`
	Pattern  string   `json:"pattern"`
	Examples []string `json:"examples"`
}

type Example struct {
	Text string `json:"text"`
	Note string `json:"note,omitempty"`
}

// CommonMistake is the wrong form, the right form and why — the shape learners remember.
type CommonMistake struct {
	Wrong string `json:"wrong"`
	Right string `json:"right"`
	Why   string `json:"why"`
	// Rule ties the mistake to the practice questions that test it.
	Rule string `json:"rule,omitempty"`
}

// Content is the canonical explanation of a topic (grammar_content.body).
type Content struct {
	Intro          string          `json:"intro"`
	Explanation    string          `json:"explanation"`
	Formulas       []Formula       `json:"formulas"`
	Usage          []string        `json:"usage"`
	SignalWords    []string        `json:"signal_words"`
	Examples       []Example       `json:"examples"`
	CommonMistakes []CommonMistake `json:"common_mistakes"`
}

// RelatedTopic is a link out of a topic, carrying why it is being shown.
type RelatedTopic struct {
	Kind string `json:"kind"`
	Note string `json:"note,omitempty"`
	TopicSummary
}

// ComparisonRow is one line of a "X vs Y" table.
type ComparisonRow struct {
	Aspect string `json:"aspect"`
	Left   string `json:"left"`
	Right  string `json:"right"`
}

type Comparison struct {
	Left    TopicSummary    `json:"left"`
	Right   TopicSummary    `json:"right"`
	Summary string          `json:"summary"`
	Rows    []ComparisonRow `json:"rows"`
}

// Progress is the learner's standing on one topic, with the signals mastery is made of.
type Progress struct {
	Mastery         float64    `json:"mastery"`
	Understanding   float64    `json:"understanding"`
	Practice        float64    `json:"practice"`
	Application     float64    `json:"application"`
	State           string     `json:"state"`
	Attempts        int        `json:"attempts"`
	Correct         int        `json:"correct"`
	LastPracticedAt *time.Time `json:"last_practiced_at"`
}

// Topic is the full topic page: canonical content plus everything around it.
type Topic struct {
	TopicSummary
	Content *Content `json:"content"`
	/** The language the explanation is actually in. Not always what was asked for: a topic
	 * that has no Uzbek explanation yet falls back to English, and the page says so rather
	 * than pretending. */
	ContentLanguage string         `json:"content_language,omitempty"`
	Prerequisites   []RelatedTopic `json:"prerequisites"`
	Related         []RelatedTopic `json:"related"`
	Compare         []RelatedTopic `json:"compare"`
	Next            []RelatedTopic `json:"next"`
	Progress        Progress       `json:"progress"`
	QuestionCount   int            `json:"question_count"`
	// Visuals already generated for this topic, so the page can show one without a request.
	Visuals []Visual `json:"visuals"`
}

type Visual struct {
	ID      uuid.UUID `json:"id"`
	Kind    string    `json:"kind"`
	URL     string    `json:"url"`
	AltText string    `json:"alt_text"`
	Caption string    `json:"caption"`
	Status  string    `json:"status"`
}

// Module wires the grammar system into the API.
type Module struct {
	pool    *pgxpool.Pool
	redis   *redis.Client
	tutor   Tutor
	storage storage.ObjectStorage
	tracker analytics.Tracker
	plans   Entitlements
	log     Logger
}

// Entitlements is the slice of the subscriptions service this package needs: what the
// learner's plan allows, and the metered budget behind it. Grammar does not know about plans,
// prices or subscriptions — only about entitlement keys.
type Entitlements interface {
	RequireFeature(ctx context.Context, userID uuid.UUID, key string) error
	ConsumeUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
	ReleaseUsage(ctx context.Context, userID uuid.UUID, key string, amount int) error
}

// Logger is the slice of *slog.Logger this package needs.
type Logger interface {
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
}

type Deps struct {
	Pool    *pgxpool.Pool
	Redis   *redis.Client
	Tutor   Tutor
	Storage storage.ObjectStorage
	Tracker analytics.Tracker
	// Plans enforces what the learner's subscription allows. When nil the AI routes are
	// open, which is only ever the case in tests that do not exercise entitlements.
	Plans Entitlements
	Log   Logger
}

func NewModule(d Deps) *Module {
	return &Module{pool: d.Pool, redis: d.Redis, tutor: d.Tutor, storage: d.Storage, tracker: d.Tracker,
		plans: d.Plans, log: d.Log}
}

// Entitlement keys for the AI features in this package. They exist in the entitlements table
// (migration 000015) and are what the owner console edits on the paywall page.
const (
	EntitlementExplanation = "grammar.ai_explanation"
	EntitlementTutor       = "grammar.ai_tutor"
	EntitlementQuestions   = "grammar.ai_questions"
	EntitlementVisualize   = "grammar.visualize"
	EntitlementVisuals     = "grammar.visuals"
)

// spend reserves one unit of a metered entitlement before work that costs money runs.
//
// Consuming first is deliberate: two requests arriving together must not both pass a check
// that reads the counter and then writes it. The increment is atomic and refuses when the
// budget is gone, so the learner is told before a provider is called rather than after.
func (m *Module) spend(ctx context.Context, userID uuid.UUID, key string) error {
	if m.plans == nil {
		return nil
	}
	return m.plans.ConsumeUsage(ctx, userID, key, 1)
}

// refund returns a unit reserved for work that then failed. Best-effort: a learner must not
// see a refund error instead of the provider error that actually stopped them.
func (m *Module) refund(ctx context.Context, userID uuid.UUID, key string) {
	if m.plans == nil {
		return
	}
	if err := m.plans.ReleaseUsage(ctx, userID, key, 1); err != nil && m.log != nil {
		m.log.Warn("grammar: refunding usage failed", "entitlement", key, "user_id", userID, "error", err)
	}
}

// requireFeature reports whether the learner's plan includes a feature at all.
func (m *Module) requireFeature(ctx context.Context, userID uuid.UUID, key string) error {
	if m.plans == nil {
		return nil
	}
	return m.plans.RequireFeature(ctx, userID, key)
}

// AI endpoint budgets. They are per user, not per IP: an expensive call is charged to the
// account that benefits from it, and one learner cannot spend another's budget.
const (
	explainPerHour   = 30
	tutorPerHour     = 40
	visualPerHour    = 10
	freeWritingPerHr = 30
)

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	// Canonical diagrams are shared product content, served like avatars and wallpapers:
	// public by unguessable id, so a plain <img> works on every client. Personal visuals
	// are never served here — the handler refuses anything with an owner.
	v1.GET("/grammar/visuals/:id", m.visual)

	g := v1.Group("/grammar", authz.RequirePermission(authz.PermLearningPractice))

	// Library. Reads are cheap and cacheable; none of them touch an AI provider.
	g.GET("/categories", m.categories)
	g.GET("/topics", m.listTopics)
	g.GET("/search", m.search)
	g.GET("/map", m.topicMap)
	g.GET("/overview", m.overview)
	g.GET("/progress", m.progress)
	g.GET("/topics/:slug", m.topic)
	g.GET("/topics/:slug/related", m.related)
	g.GET("/topics/:slug/compare/:other", m.comparison)

	// Practice. Everything here is scored in Go except free-writing analysis.
	g.POST("/topics/:slug/practice", m.startPractice)
	g.POST("/attempts/:id/answers", m.submitAnswer)
	g.POST("/attempts/:id/complete", m.completeAttempt)
	g.GET("/attempts/:id", m.attempt)

	// AI. Each one is rate limited per user and cached or reused wherever it can be.
	ai := g.Group("")
	if m.redis != nil {
		limiter := ratelimit.NewRedisLimiter(m.redis)
		ai.POST("/topics/:slug/ai/explain", m.userLimit(limiter, "grammar_explain", explainPerHour), m.aiExplain)
		ai.POST("/topics/:slug/ai/ask", m.userLimit(limiter, "grammar_tutor", tutorPerHour), m.aiAsk)
		ai.POST("/topics/:slug/ai/visual", m.userLimit(limiter, "grammar_visual", visualPerHour), m.aiVisual)
	} else {
		ai.POST("/topics/:slug/ai/explain", m.aiExplain)
		ai.POST("/topics/:slug/ai/ask", m.aiAsk)
		ai.POST("/topics/:slug/ai/visual", m.aiVisual)
	}
}

// userLimit rate limits by user ID. ratelimit.Middleware keys on the client IP, which is
// wrong for AI spend: learners behind one NAT would share a budget, and one account on many
// IPs would have none.
func (m *Module) userLimit(l ratelimit.Limiter, bucket string, perHour int) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, ok := authz.PrincipalFrom(c)
		if !ok {
			httpx.WriteError(c, apperr.Unauthorized("Authentication required"))
			return
		}
		d, err := l.Allow(c.Request.Context(), bucket+":"+p.UserID.String(), perHour, time.Hour)
		if err != nil {
			// A limiter outage must not take the feature down; the provider has its own limits.
			m.log.Warn("grammar rate limiter unavailable, allowing request", "bucket", bucket, "error", err.Error())
			c.Next()
			return
		}
		if !d.Allowed {
			seconds := max(int(d.RetryAfter.Seconds()), 1)
			httpx.WriteError(c, apperr.New(apperr.CodeRateLimited,
				"You have used this AI feature a lot in the last hour. Your grammar lessons and practice still work.").
				WithDetails(map[string]any{"retry_after_seconds": seconds}))
			return
		}
		c.Next()
	}
}
