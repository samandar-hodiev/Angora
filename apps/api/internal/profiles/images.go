package profiles

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// imageAsset describes an image a learner can upload to their own profile: the avatar, and
// the background for the app's main area. The storage prefix and the column names are
// constants declared here and never taken from a request, so the shared SQL below cannot be
// steered by a client.
type imageAsset struct {
	kind        string // storage prefix and public route segment, e.g. "avatars"
	label       string // what a "not found" response calls it
	maxBytes    int64
	keyColumn   string
	urlColumn   string
	uploadError string // shown to the learner when storage is unavailable
}

var (
	avatarAsset = imageAsset{
		kind: "avatars", label: "Avatar", maxBytes: maxAvatarBytes,
		keyColumn: "avatar_storage_key", urlColumn: "avatar_url",
		uploadError: "We couldn't upload your photo. Please try again.",
	}
	wallpaperAsset = imageAsset{
		kind: "wallpapers", label: "Background", maxBytes: maxWallpaperBytes,
		keyColumn: "wallpaper_storage_key", urlColumn: "wallpaper_url",
		uploadError: "We couldn't upload your background. Please try again.",
	}
)

// publicURL is the path clients load the image from, e.g. /api/v1/avatars/<key>.
func (a imageAsset) publicURL(key string) string {
	return "/api/v1/" + a.kind + "/" + strings.TrimPrefix(key, a.kind+"/")
}

func (m *Module) uploadImage(c *gin.Context, a imageAsset) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		httpx.Fail(c, apperr.Validation(map[string]any{"fields": map[string]any{"file": "is required"}}))
		return
	}
	defer file.Close()

	ctx := c.Request.Context()
	data, err := io.ReadAll(io.LimitReader(file, a.maxBytes+1))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("The image could not be read. Please try again."))
		return
	}
	allowed, err := storage.ImagePolicy(a.maxBytes).Validate(header.Header.Get("Content-Type"), int64(len(data)), data[:min(len(data), 512)])
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	key := storage.NewKey(a.kind, p.UserID, allowed.Extension, time.Now())
	if err := m.store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), allowed.Canonical); err != nil {
		logger.FromContext(ctx, m.log).Error("store image failed",
			slog.String("kind", a.kind), slog.String("error", err.Error()))
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, a.uploadError))
		return
	}

	previous, err := m.swapImageKey(ctx, p.UserID, a, &key)
	if err != nil {
		_ = m.store.Delete(context.WithoutCancel(ctx), key)
		httpx.Fail(c, err)
		return
	}
	if previous != nil && *previous != key {
		_ = m.store.Delete(context.WithoutCancel(ctx), *previous)
	}
	m.respondProfile(c, p.UserID)
}

func (m *Module) deleteImage(c *gin.Context, a imageAsset) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	previous, err := m.swapImageKey(ctx, p.UserID, a, nil)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if previous != nil {
		_ = m.store.Delete(context.WithoutCancel(ctx), *previous)
	}
	m.respondProfile(c, p.UserID)
}

// serveImage streams a stored image. The key is public but unguessable, and it is served
// only while a profile still points at it.
func (m *Module) serveImage(c *gin.Context, a imageAsset) {
	key := a.kind + "/" + strings.TrimPrefix(c.Param("key"), "/")
	if storage.ValidateKey(key) != nil {
		httpx.Fail(c, apperr.NotFound(a.label))
		return
	}
	ctx := c.Request.Context()
	var exists bool
	query := fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM profiles WHERE %s = $1)`, a.keyColumn)
	if err := m.pool.QueryRow(ctx, query, key).Scan(&exists); err != nil || !exists {
		httpx.Fail(c, apperr.NotFound(a.label))
		return
	}
	body, info, err := m.store.Get(ctx, key)
	if err != nil {
		httpx.Fail(c, apperr.NotFound(a.label))
		return
	}
	defer body.Close()
	c.DataFromReader(200, info.Size, info.ContentType, body, map[string]string{
		"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
	})
}

// swapImageKey points the profile at a newly stored object (or clears it with a nil key) and
// returns the key it replaced, so those bytes can be deleted afterwards.
func (m *Module) swapImageKey(ctx context.Context, userID uuid.UUID, a imageAsset, key *string) (*string, error) {
	var url *string
	if key != nil {
		u := a.publicURL(*key)
		url = &u
	}
	query := fmt.Sprintf(`
		UPDATE profiles p SET %s = $2, %s = $3
		FROM (SELECT %s AS previous FROM profiles WHERE user_id = $1) old
		WHERE p.user_id = $1 RETURNING old.previous`, a.keyColumn, a.urlColumn, a.keyColumn)

	var previous *string
	if err := m.pool.QueryRow(ctx, query, userID, key, url).Scan(&previous); err != nil {
		return nil, fmt.Errorf("update profile %s: %w", a.kind, err)
	}
	return previous, nil
}

func (m *Module) respondProfile(c *gin.Context, userID uuid.UUID) {
	profile, err := m.Get(c.Request.Context(), userID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, profile)
}
