// Package storage abstracts object storage for learner audio and other media.
//
// Bytes live in object storage (Cloudflare R2, AWS S3, or the local filesystem in
// development). PostgreSQL stores only metadata (audio_files: storage_key, mime_type,
// size, duration). Business code depends on ObjectStorage and never on a vendor SDK.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ObjectInfo struct {
	Key          string
	Size         int64
	ContentType  string
	LastModified time.Time
}

// PresignedRequest lets a client upload or download directly to/from the bucket, keeping
// large audio transfers off the API servers.
type PresignedRequest struct {
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expires_at"`
}

type ObjectStorage interface {
	// Provider names the backend ("local", "s3") for the audio_files.storage_provider column.
	Provider() string
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error)
	Stat(ctx context.Context, key string) (ObjectInfo, error)
	Delete(ctx context.Context, key string) error
	PresignPut(ctx context.Context, key, contentType string, ttl time.Duration) (PresignedRequest, error)
	PresignGet(ctx context.Context, key string, ttl time.Duration) (PresignedRequest, error)
}

var (
	ErrNotFound           = errors.New("object not found")
	ErrInvalidKey         = errors.New("invalid object key")
	ErrPresignUnsupported = errors.New("presigned URLs are not supported by this storage provider")
)

var keyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9/_.-]{0,511}$`)

// ValidateKey rejects keys that could escape a prefix or a local root directory.
func ValidateKey(key string) error {
	if !keyPattern.MatchString(key) || strings.Contains(key, "..") || strings.Contains(key, "//") {
		return ErrInvalidKey
	}
	return nil
}

// NewKey builds a collision-free, non-guessable key partitioned by kind, owner and month:
//
//	audio/<user-id>/2026/09/<uuid>.webm
//
// Keys never contain user-provided file names.
func NewKey(kind string, ownerID uuid.UUID, ext string, now time.Time) string {
	now = now.UTC()
	return fmt.Sprintf("%s/%s/%04d/%02d/%s%s", kind, ownerID, now.Year(), now.Month(), uuid.New(), ext)
}
