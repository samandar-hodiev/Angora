package admin

import (
	"context"
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// ActionGrammarContentDeleted is the audit action for wiping a topic's content.
const ActionGrammarContentDeleted = "grammar_content.deleted"

// DELETE /admin/grammar/topics/:slug/content — everything written for a topic, gone.
//
// The topic itself stays in the curriculum: its name, category, level and relations are the
// map, not content. What goes is everything made for it — the explanation in every language
// and version, the questions, the writing and speaking tasks, the visuals, the cached AI
// explanations — and the learners' progress on it, which measured content that no longer
// exists. The topic goes back to draft, so learners see it as coming soon until it is
// written and published again. There is no undo; the console asks before it calls this.
func (m *Module) deleteGrammarContent(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	slug := c.Param("slug")
	ctx := c.Request.Context()
	var topicID uuid.UUID
	if err := m.pool.QueryRow(ctx, `SELECT id FROM grammar_topics WHERE slug = $1`, slug).Scan(&topicID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Fail(c, apperr.NotFound("Grammar topic"))
			return
		}
		httpx.Fail(c, err)
		return
	}
	removed, err := wipeGrammarContent(ctx, m.pool, topicID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	recordGrammarAudit(ctx, m.audit, p.UserID, ActionGrammarContentDeleted, slug, removed)
	out, err := m.loadTopicContent(ctx, slug, "en")
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

// wipeGrammarContent removes everything written for one topic and returns how much of each.
func wipeGrammarContent(ctx context.Context, pool *pgxpool.Pool, topicID uuid.UUID) (map[string]any, error) {
	removed := map[string]any{}
	err := database.WithTx(ctx, pool, func(tx pgx.Tx) error {
		// Answers go with their questions (ON DELETE CASCADE).
		for _, table := range []string{
			"grammar_content", "grammar_questions", "grammar_practice_tasks", "grammar_visuals",
			"grammar_ai_explanations", "grammar_attempts", "grammar_user_errors", "user_grammar_progress",
		} {
			tag, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE grammar_topic_id = $1`, topicID)
			if err != nil {
				return err
			}
			removed[table] = tag.RowsAffected()
		}
		_, err := tx.Exec(ctx, `UPDATE grammar_topics SET status = 'draft', updated_at = now() WHERE id = $1 AND status = 'published'`, topicID)
		return err
	})
	return removed, err
}
