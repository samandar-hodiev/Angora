package vocabulary

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// EntitlementLadder meters ladders that have to be written; one already written is free.
const EntitlementLadder = "vocabulary.ai_ladder"

type ladderInput struct {
	Term string `json:"term" binding:"required,max=40"`
}

// LadderResponse is a ladder with which of its words are in the library.
type LadderResponse struct {
	Ladder *ai.Ladder `json:"ladder"`
	/** Rung words in the library, by lower-case term, so they can be opened. */
	Library map[string]uuid.UUID `json:"library"`
	Cached  bool                 `json:"cached"`
}

// POST /vocabulary/ladder — one meaning of a word, with the word for it at each level.
func (m *Module) ladder(c *gin.Context) {
	p, _ := authz.PrincipalFrom(c)
	var in ladderInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	terms, err := NormalizeTerms([]string{in.Term})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	term := terms[0]
	ctx := c.Request.Context()

	out := LadderResponse{}
	var cached []byte
	err = m.pool.QueryRow(ctx, `SELECT body FROM vocabulary_ladders WHERE term_key = $1 AND prompt_version = $2`,
		term, ai.VocabularyLadderPrompt).Scan(&cached)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(c, err)
		return
	}
	if len(cached) > 0 {
		var l ai.Ladder
		if json.Unmarshal(cached, &l) == nil {
			out.Ladder, out.Cached = &l, true
		}
	}
	if out.Ladder == nil {
		ladder, meta, err := m.writeLadder(ctx, p.UserID, term)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		out.Ladder = ladder
		if body, err := json.Marshal(ladder); err == nil {
			var requestID *uuid.UUID
			if meta != nil && meta.AIRequestID != uuid.Nil {
				requestID = &meta.AIRequestID
			}
			if _, err := m.pool.Exec(ctx, `
				INSERT INTO vocabulary_ladders (term_key, prompt_version, body, model, ai_request_id)
				VALUES ($1, $2, $3, $4, $5) ON CONFLICT (term_key, prompt_version) DO NOTHING`,
				term, ai.VocabularyLadderPrompt, body, meta.ModelVersion, requestID); err != nil {
				m.warn("vocabulary: ladder not cached", "term", term, "error", err.Error())
			}
		}
	}
	rungs := []string{}
	for _, r := range out.Ladder.Rungs {
		if r.Term != "" {
			rungs = append(rungs, strings.ToLower(r.Term))
		}
	}
	if out.Library, err = m.libraryIDs(ctx, rungs); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

// writeLadder charges the plan, asks the model and refunds when nothing usable comes back.
func (m *Module) writeLadder(ctx context.Context, userID uuid.UUID, term string) (*ai.Ladder, *ai.EvaluationMeta, error) {
	if m.ai == nil {
		return nil, nil, apperr.NotImplemented("Level ladders")
	}
	if m.plans != nil {
		if err := m.plans.ConsumeUsage(ctx, userID, EntitlementLadder, 1); err != nil {
			return nil, nil, err
		}
	}
	refund := func() {
		if m.plans != nil {
			if err := m.plans.ReleaseUsage(context.WithoutCancel(ctx), userID, EntitlementLadder, 1); err != nil {
				m.warn("vocabulary: refunding ladder failed", "user_id", userID, "error", err.Error())
			}
		}
	}
	ladder, meta, err := m.ai.WriteLadder(ctx, term, &userID)
	if err != nil {
		refund()
		var appErr *apperr.Error
		if errors.As(err, &appErr) && appErr.Code == apperr.CodeNotImplemented {
			return nil, nil, appErr
		}
		m.warn("vocabulary: ladder failed", "term", term, "error", err.Error())
		return nil, nil, apperr.Wrap(err, apperr.CodeUnavailable, "Level ladders are temporarily unavailable. Please try again.")
	}
	if ladder.Invalid {
		refund()
		return nil, nil, apperr.Validation(map[string]any{"fields": map[string]any{"term": "not an English word: " + term}})
	}
	if meta == nil {
		meta = &ai.EvaluationMeta{}
	}
	return ladder, meta, nil
}
