package vocabulary

import (
	"context"
	"errors"
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

// RelatedWord is a word named on another word's page — a synonym, an opposite, a word from the
// same topic — with its id when it is in the library, so the page can open it.
type RelatedWord struct {
	Term  string     `json:"term"`
	ID    *uuid.UUID `json:"id"`
	Level *string    `json:"level"`
	Uz    string     `json:"uz,omitempty"`
}

// DeckState is where the word stands in the learner's own deck.
type DeckState struct {
	Status         string     `json:"status"`
	Mastery        int        `json:"mastery"`
	DueAt          time.Time  `json:"due_at"`
	LastReviewedAt *time.Time `json:"last_reviewed_at"`
	Reviews        int        `json:"reviews"`
}

// WordDetail is everything about one word: what it means at every level, how it sounds, how it
// is used, what it is near, and where the learner stands with it.
type WordDetail struct {
	LibraryWord
	Usage     ai.WordUsage  `json:"usage"`
	Synonyms  []RelatedWord `json:"synonyms"`
	Antonyms  []RelatedWord `json:"antonyms"`
	SameTopic []RelatedWord `json:"same_topic"`
	Deck      *DeckState    `json:"deck"`
	/** The learner's level: the explanation the page opens on. */
	LearnerLevel string `json:"learner_level"`
}

// GET /vocabulary/words/:id
//
// A word published before usage notes existed gets them written here, the first time any
// learner opens it, and stored on the word for everyone after. If that fails the word is shown
// without them: its meaning, translations and examples do not depend on it.
func (m *Module) word(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid word id"))
		return
	}
	ctx := c.Request.Context()

	var w WordDetail
	var definition string
	var examples []string
	var enrichedAt *time.Time
	var deckStatus *string
	var repetitions *int
	var dueAt *time.Time
	var lastReviewed *time.Time
	err = m.pool.QueryRow(ctx, `
		SELECT v.id, v.term, v.part_of_speech, v.pronunciation_ipa, l.code, v.tags, v.translations, v.level_content,
		       v.definition, v.examples, v.usage_note, v.register, v.collocations, v.synonyms, v.antonyms,
		       v.word_family, v.common_mistake, v.enriched_at,
		       uv.status, uv.repetitions, uv.due_at, uv.last_reviewed_at
		FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id
		LEFT JOIN user_vocabulary uv ON uv.vocabulary_id = v.id AND uv.user_id = $2
		WHERE v.id = $1 AND v.status = 'published'`, id, p.UserID,
	).Scan(&w.ID, &w.Term, &w.PartOfSpeech, &w.PronunciationIPA, &w.Level, &w.Tags, &w.Translations, &w.LevelContent,
		&definition, &examples, &w.Usage.UsageNote, &w.Usage.Register, &w.Usage.Collocations, &w.Usage.Synonyms,
		&w.Usage.Antonyms, &w.Usage.WordFamily, &w.Usage.CommonMistake, &enrichedAt,
		&deckStatus, &repetitions, &dueAt, &lastReviewed)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, apperr.NotFound("Word"))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	w.LevelContent = withOwnLevel(w.LevelContent, w.Level, definition, examples)
	w.LearnerLevel = m.learnerLevel(ctx, p.UserID)
	if w.Tags == nil {
		w.Tags = []string{}
	}

	if enrichedAt == nil && w.Usage.Empty() {
		if usage, ok := m.enrich(ctx, w, definition); ok {
			w.Usage = usage
		}
	}
	w.Usage = w.Usage.Clean(w.Term)
	w.Register = w.Usage.Register

	if deckStatus != nil {
		w.InDeck, w.DeckStatus = true, deckStatus
		state := DeckState{Status: *deckStatus, LastReviewedAt: lastReviewed}
		if repetitions != nil {
			state.Mastery = Mastery(*deckStatus, *repetitions)
		}
		if dueAt != nil {
			state.DueAt = *dueAt
		}
		_ = m.pool.QueryRow(ctx, `SELECT count(*)::int FROM vocabulary_reviews WHERE user_id = $1 AND vocabulary_id = $2`,
			p.UserID, id).Scan(&state.Reviews)
		w.Deck = &state
	}

	if w.Synonyms, err = m.resolve(ctx, w.Usage.Synonyms); err != nil {
		httpx.Fail(c, err)
		return
	}
	if w.Antonyms, err = m.resolve(ctx, w.Usage.Antonyms); err != nil {
		httpx.Fail(c, err)
		return
	}
	if w.SameTopic, err = m.sameTopic(ctx, w.ID, w.Tags, w.Level); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, w)
}

// enrich writes usage notes for a word that has none and stores them on the word. A lock keeps
// two learners opening the same word at once from paying for it twice.
func (m *Module) enrich(ctx context.Context, w WordDetail, definition string) (ai.WordUsage, bool) {
	if m.ai == nil {
		return ai.WordUsage{}, false
	}
	if m.redis != nil {
		ok, err := m.redis.SetNX(ctx, "vocabulary:enrich:"+w.ID.String(), 1, 2*time.Minute).Result()
		if err == nil && !ok {
			return ai.WordUsage{}, false
		}
	}
	level := "B1"
	if w.Level != nil {
		level = *w.Level
	}
	if definition == "" {
		if t, ok := w.LevelContent[level]; ok {
			definition = t.Definition
		}
	}
	// The learner is waiting for the page; a slow provider should not hold it for long.
	callCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	usage, _, err := m.ai.EnrichWord(callCtx, ai.EnrichRequest{
		Term: w.Term, PartOfSpeech: w.PartOfSpeech, Level: level, Definition: definition,
	})
	if err != nil {
		m.warn("vocabulary: writing word usage failed", "word", w.Term, "error", err.Error())
		return ai.WordUsage{}, false
	}
	if _, err := m.pool.Exec(ctx, `
		UPDATE vocabulary SET usage_note = $2, register = $3, collocations = $4, synonyms = $5, antonyms = $6,
		       word_family = $7, common_mistake = $8, enriched_at = now()
		WHERE id = $1 AND enriched_at IS NULL`, w.ID, usage.UsageNote, usage.Register, nonNil(usage.Collocations),
		nonNil(usage.Synonyms), nonNil(usage.Antonyms), nonNil(usage.WordFamily), usage.CommonMistake); err != nil {
		m.warn("vocabulary: storing word usage failed", "word", w.Term, "error", err.Error())
	}
	return usage, true
}

// resolve finds the named words in the published library, keeping the order they were given in.
func (m *Module) resolve(ctx context.Context, terms []string) ([]RelatedWord, error) {
	out := make([]RelatedWord, 0, len(terms))
	if len(terms) == 0 {
		return out, nil
	}
	lower := make([]string, len(terms))
	for i, t := range terms {
		lower[i] = strings.ToLower(t)
	}
	rows, err := m.pool.Query(ctx, `
		SELECT DISTINCT ON (lower(v.term)) lower(v.term), v.id, l.code, COALESCE(v.translations->>'uz', '')
		FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id
		WHERE v.status = 'published' AND lower(v.term) = ANY ($1)
		ORDER BY lower(v.term), v.published_at`, lower)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	found := map[string]RelatedWord{}
	for rows.Next() {
		var key string
		var r RelatedWord
		var id uuid.UUID
		if err := rows.Scan(&key, &id, &r.Level, &r.Uz); err != nil {
			return nil, err
		}
		r.ID = &id
		found[key] = r
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, t := range terms {
		r := found[lower[i]]
		r.Term = t
		out = append(out, r)
	}
	return out, nil
}

// sameTopic is a handful of other words sharing a topic with this one, nearest level first.
func (m *Module) sameTopic(ctx context.Context, id uuid.UUID, tags []string, level *string) ([]RelatedWord, error) {
	out := []RelatedWord{}
	if len(tags) == 0 {
		return out, nil
	}
	code := "B1"
	if level != nil {
		code = *level
	}
	rows, err := m.pool.Query(ctx, `
		SELECT v.id, v.term, l.code, COALESCE(v.translations->>'uz', '')
		FROM vocabulary v LEFT JOIN levels l ON l.id = v.level_id
		WHERE v.status = 'published' AND v.id <> $1 AND v.tags && $2
		ORDER BY abs(COALESCE(l.rank, 3) - COALESCE((SELECT rank FROM levels WHERE code = $3), 3)), lower(v.term)
		LIMIT 8`, id, tags, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r RelatedWord
		var wid uuid.UUID
		if err := rows.Scan(&wid, &r.Term, &r.Level, &r.Uz); err != nil {
			return nil, err
		}
		r.ID = &wid
		out = append(out, r)
	}
	return out, rows.Err()
}

func nonNil(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}
