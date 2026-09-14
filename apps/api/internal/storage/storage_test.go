package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

func TestLocalRoundTrip(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := NewKey("audio", uuid.New(), ".webm", time.Now())

	if err := store.Put(ctx, key, bytes.NewReader([]byte("voice")), 5, "audio/webm"); err != nil {
		t.Fatal(err)
	}
	rc, info, err := store.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(rc)
	rc.Close()
	if string(data) != "voice" || info.Size != 5 {
		t.Errorf("got %q (size %d)", data, info.Size)
	}

	if err := store.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Stat(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Errorf("after delete: err = %v, want ErrNotFound", err)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Errorf("delete must be idempotent: %v", err)
	}
	if _, err := store.PresignPut(ctx, key, "audio/webm", time.Minute); !errors.Is(err, ErrPresignUnsupported) {
		t.Errorf("local presign: err = %v", err)
	}
}

func TestKeysCannotEscapeRoot(t *testing.T) {
	store, _ := NewLocal(t.TempDir())
	for _, key := range []string{"../etc/passwd", "/abs/path", "audio/../../x", "audio//x", "Audio/UPPER", ""} {
		if err := store.Put(context.Background(), key, bytes.NewReader(nil), 0, ""); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("key %q: err = %v, want ErrInvalidKey", key, err)
		}
	}
}

func TestNewKeyFormat(t *testing.T) {
	owner := uuid.MustParse("7f000000-0000-4000-8000-000000000001")
	key := NewKey("audio", owner, ".m4a", time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC))
	want := regexp.MustCompile(`^audio/7f000000-0000-4000-8000-000000000001/2026/03/[0-9a-f-]{36}\.m4a$`)
	if !want.MatchString(key) || ValidateKey(key) != nil {
		t.Errorf("key = %q", key)
	}
}

func TestAudioPolicy(t *testing.T) {
	policy := AudioPolicy(1 << 20)
	webm := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01}
	wav := append([]byte("RIFF\x24\x00\x00\x00WAVEfmt "), make([]byte, 16)...)
	m4a := []byte("\x00\x00\x00\x1cftypM4A \x00\x00\x00\x00M4A mp42isom\x00\x00\x00\x08free")
	exe := []byte("MZ\x90\x00\x03\x00\x00\x00")

	cases := []struct {
		name     string
		declared string
		size     int64
		head     []byte
		wantCode apperr.Code // empty = valid
		wantType string
	}{
		{"browser webm with codecs", "audio/webm;codecs=opus", 100, webm, "", "audio/webm"},
		{"wav", "audio/x-wav", 100, wav, "", "audio/wav"},
		{"ios m4a", "audio/x-m4a", 100, m4a, "", "audio/mp4"},
		{"too large", "audio/webm", 2 << 20, webm, apperr.CodePayloadTooLarge, ""},
		{"empty", "audio/webm", 0, nil, apperr.CodeValidation, ""},
		{"undeclared type", "application/pdf", 100, webm, apperr.CodeUnsupportedMedia, ""},
		{"executable disguised as audio", "audio/webm", 100, exe, apperr.CodeUnsupportedMedia, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := policy.Validate(tc.declared, tc.size, tc.head)
			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if got.Canonical != tc.wantType {
					t.Errorf("canonical = %s, want %s", got.Canonical, tc.wantType)
				}
				return
			}
			if !apperr.Is(err, tc.wantCode) {
				t.Errorf("err = %v, want %s", err, tc.wantCode)
			}
		})
	}
}
