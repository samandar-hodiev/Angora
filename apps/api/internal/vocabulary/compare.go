package vocabulary

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Comparing words.
//
// "Job" and "occupation" are both "kasb"; "make" and "do" are both "qilmoq". A learner who
// translates in their head cannot tell them apart from a dictionary. A comparison answers that
// directly — the difference, when to use each, and a short quiz to check it stuck — and is
// written once for every learner at that level who asks the same thing.

type compareInput struct {
	Terms []string `json:"terms" binding:"required,min=2,max=3,dive,required,max=40"`
}

// ComparisonResponse is a comparison with where it came from.
type ComparisonResponse struct {
	Terms      []string           `json:"terms"`
	Level      string             `json:"level"`
	Comparison *ai.WordComparison `json:"comparison"`
	/** Words of the comparison that are in the library, by lower-case term, so they can be opened. */
	Library map[string]uuid.UUID `json:"library"`
	Cached  bool                 `json:"cached"`
}

var termPattern = regexp.MustCompile(`^[a-z][a-z' -]{0,39}$`)

// NormalizeTerms lower-cases and tidies the words, refusing anything that is not a plain
// English word or short phrase, and repeats.
func NormalizeTerms(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(t))), " ")
		t = strings.ReplaceAll(t, "’", "'")
		if !termPattern.MatchString(t) {
			return nil, apperr.Validation(map[string]any{
				"fields": map[string]any{"terms": "use English words or short phrases: letters, spaces, hyphens and apostrophes"},
			})
		}
		if slices.Contains(out, t) {
			return nil, apperr.Validation(map[string]any{"fields": map[string]any{"terms": "pick different words to compare"}})
		}
		out = append(out, t)
	}
	return out, nil
}

// termsKey is the cache key: the same words in any order are the same comparison.
func termsKey(terms []string) string {
	sorted := slices.Clone(terms)
	slices.Sort(sorted)
	return strings.Join(sorted, "|")
}

// POST /vocabulary/compare
func (m *Module) compare(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var in compareInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	terms, err := NormalizeTerms(in.Terms)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	level := m.learnerLevel(ctx, p.UserID)
	key := termsKey(terms)
	out := ComparisonResponse{Terms: terms, Level: level}
	if out.Library, err = m.libraryIDs(ctx, terms); err != nil {
		httpx.Fail(c, err)
		return
	}

	var cached []byte
	err = m.pool.QueryRow(ctx, `
		SELECT body FROM vocabulary_comparisons WHERE terms_key = $1 AND level_code = $2 AND prompt_version = $3`,
		key, level, ai.VocabularyComparePrompt).Scan(&cached)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, err)
		return
	}
	if len(cached) > 0 {
		var cmp ai.WordComparison
		if json.Unmarshal(cached, &cmp) == nil {
			out.Comparison, out.Cached = &cmp, true
			httpx.OK(c, out)
			return
		}
	}

	if m.ai == nil {
		httpx.Fail(c, apperr.NotImplemented("Comparing words"))
		return
	}
	// Past the cache, so this one costs money: charge the plan first, refund if it fails.
	if m.plans != nil {
		if err := m.plans.ConsumeUsage(ctx, p.UserID, EntitlementCompare, 1); err != nil {
			httpx.Fail(c, err)
			return
		}
	}
	refund := func() {
		if m.plans != nil {
			if err := m.plans.ReleaseUsage(context.WithoutCancel(ctx), p.UserID, EntitlementCompare, 1); err != nil {
				m.warn("vocabulary: refunding comparison failed", "user_id", p.UserID, "error", err.Error())
			}
		}
	}
	cmp, meta, err := m.ai.CompareWords(ctx, ai.CompareRequest{Terms: terms, Level: level, UserID: &p.UserID})
	if err != nil {
		refund()
		var appErr *apperr.Error
		if errors.As(err, &appErr) && appErr.Code == apperr.CodeNotImplemented {
			httpx.Fail(c, appErr)
			return
		}
		m.warn("vocabulary: comparison failed", "terms", key, "error", err.Error())
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable, "Comparing words is temporarily unavailable. Please try again."))
		return
	}
	if len(cmp.Invalid) > 0 {
		// Not a comparison anyone else will ask for, and not one the learner should pay for.
		refund()
		httpx.Fail(c, apperr.Validation(map[string]any{
			"fields": map[string]any{"terms": "not an English word: " + strings.Join(cmp.Invalid, ", ")},
		}))
		return
	}
	out.Comparison = cmp
	if body, err := json.Marshal(cmp); err == nil {
		var requestID *uuid.UUID
		if meta != nil && meta.AIRequestID != uuid.Nil {
			requestID = &meta.AIRequestID
		}
		model := ""
		if meta != nil {
			model = meta.ModelVersion
		}
		if _, err := m.pool.Exec(ctx, `
			INSERT INTO vocabulary_comparisons (terms_key, level_code, prompt_version, body, model, ai_request_id)
			VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (terms_key, level_code, prompt_version) DO NOTHING`,
			key, level, ai.VocabularyComparePrompt, body, model, requestID); err != nil {
			m.warn("vocabulary: comparison not cached", "terms", key, "error", err.Error())
		}
	}
	httpx.OK(c, out)
}

// libraryIDs finds which of the words are published in the library.
func (m *Module) libraryIDs(ctx context.Context, terms []string) (map[string]uuid.UUID, error) {
	out := map[string]uuid.UUID{}
	rows, err := m.pool.Query(ctx, `
		SELECT DISTINCT ON (lower(term)) lower(term), id FROM vocabulary
		WHERE status = 'published' AND lower(term) = ANY ($1) ORDER BY lower(term), published_at`, terms)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t string
		var id uuid.UUID
		if err := rows.Scan(&t, &id); err != nil {
			return nil, err
		}
		out[t] = id
	}
	return out, rows.Err()
}
