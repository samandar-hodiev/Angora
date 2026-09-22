package owner

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// The console background.
//
// The same shape as the learner wallpaper, and for the same reasons: the image bytes go to
// object storage and the database keeps a key and a URL. An image column in PostgreSQL
// would put megabytes into every backup, every replica and every query plan that touches
// the row.
//
// Validation is server-side and does not trust the client: the declared type, the real
// first bytes and the actual length all have to agree, so renaming a .exe to .png does not
// get it stored.

const wallpaperPrefix = "owner-wallpapers"

func (m *Module) uploadWallpaper(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if m.store == nil {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "Uploads are not available right now"))
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"file": "is required"}}))
		return
	}
	defer func() { _ = file.Close() }()

	ctx := c.Request.Context()
	// One byte past the limit, so an oversized file is refused rather than truncated.
	data, err := io.ReadAll(io.LimitReader(file, MaxWallpaperBytes+1))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("The image could not be read. Please try again."))
		return
	}
	allowed, err := storage.ImagePolicy(MaxWallpaperBytes).
		Validate(header.Header.Get("Content-Type"), int64(len(data)), data[:min(len(data), 512)])
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	key := storage.NewKey(wallpaperPrefix, p.UserID, allowed.Extension, time.Now())
	if err := m.store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), allowed.Canonical); err != nil {
		logger.FromContext(ctx, m.log).Error("store console wallpaper failed", slog.String("error", err.Error()))
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "We couldn't upload that background. Please try again."))
		return
	}

	previous, err := m.swapWallpaper(ctx, p.UserID, &key)
	if err != nil {
		// The row did not take the new key, so the bytes we just wrote are orphaned.
		_ = m.store.Delete(context.WithoutCancel(ctx), key)
		httpx.Fail(c, err)
		return
	}
	if previous != nil && *previous != key {
		_ = m.store.Delete(context.WithoutCancel(ctx), *previous)
	}
	m.preferences(c)
}

func (m *Module) deleteWallpaper(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	previous, err := m.swapWallpaper(ctx, p.UserID, nil)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if previous != nil && m.store != nil {
		_ = m.store.Delete(context.WithoutCancel(ctx), *previous)
	}
	m.preferences(c)
}

// serveWallpaper streams a stored background. The key is public but unguessable, and it is
// served only while a preference row still points at it — so removing a background stops it
// being readable, rather than merely hiding it.
func (m *Module) serveWallpaper(c *gin.Context) {
	key := wallpaperPrefix + "/" + strings.TrimPrefix(c.Param("key"), "/")
	if storage.ValidateKey(key) != nil || m.store == nil {
		httpx.Fail(c, apperr.NotFound("Background"))
		return
	}
	ctx := c.Request.Context()
	var exists bool
	if err := m.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM owner_preferences WHERE wallpaper_storage_key = $1)`, key).
		Scan(&exists); err != nil || !exists {
		httpx.Fail(c, apperr.NotFound("Background"))
		return
	}
	body, info, err := m.store.Get(ctx, key)
	if err != nil {
		httpx.Fail(c, apperr.NotFound("Background"))
		return
	}
	defer func() { _ = body.Close() }()
	c.DataFromReader(200, info.Size, info.ContentType, body, map[string]string{
		"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
	})
}

// swapWallpaper points the preference row at a newly stored object (or clears it) and
// returns the key it replaced, so those bytes can be deleted afterwards. Uploading a
// background also switches it on: nobody uploads one in order to leave it off.
func (m *Module) swapWallpaper(ctx context.Context, userID uuid.UUID, key *string) (*string, error) {
	var url *string
	if key != nil {
		u := "/api/v1/" + wallpaperPrefix + "/" + strings.TrimPrefix(*key, wallpaperPrefix+"/")
		url = &u
	}
	// Read then write, in one transaction. A subquery in RETURNING would be evaluated
	// against the statement's own snapshot, which is exactly the kind of "probably fine"
	// that leaves orphaned megabytes in object storage when it is not.
	var previous *string
	err := database.WithTx(ctx, m.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`SELECT wallpaper_storage_key FROM owner_preferences WHERE user_id = $1 FOR UPDATE`, userID).
			Scan(&previous); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO owner_preferences (user_id, wallpaper_storage_key, wallpaper_url, wallpaper_enabled)
			VALUES ($1, $2::text, $3::text, $2::text IS NOT NULL)
			ON CONFLICT (user_id) DO UPDATE SET
				wallpaper_storage_key = $2::text,
				wallpaper_url         = $3::text,
				wallpaper_enabled     = ($2::text IS NOT NULL)`,
			userID, key, url)
		return err
	})
	return previous, err
}
