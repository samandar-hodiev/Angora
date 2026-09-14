package storage

import (
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

// UploadPolicy validates an upload using both the declared Content-Type and the file's
// actual leading bytes, so a renamed executable cannot be stored as "audio".
type UploadPolicy struct {
	MaxBytes int64
	// Allowed maps a declared MIME type to the canonical type stored and the types
	// http.DetectContentType may report for genuine files of that format.
	Allowed map[string]AllowedType
}

type AllowedType struct {
	Canonical string
	Extension string
	Sniffed   []string
}

// AudioPolicy covers what browsers (MediaRecorder: webm/ogg) and iOS/Android recorders
// (m4a/mp4, wav, mp3) produce.
func AudioPolicy(maxBytes int64) UploadPolicy {
	webm := AllowedType{Canonical: "audio/webm", Extension: ".webm", Sniffed: []string{"video/webm", "audio/webm"}}
	ogg := AllowedType{Canonical: "audio/ogg", Extension: ".ogg", Sniffed: []string{"application/ogg", "audio/ogg"}}
	mp4 := AllowedType{Canonical: "audio/mp4", Extension: ".m4a", Sniffed: []string{"video/mp4", "audio/mp4"}}
	wav := AllowedType{Canonical: "audio/wav", Extension: ".wav", Sniffed: []string{"audio/wave"}}
	mp3 := AllowedType{Canonical: "audio/mpeg", Extension: ".mp3", Sniffed: []string{"audio/mpeg"}}
	return UploadPolicy{
		MaxBytes: maxBytes,
		Allowed: map[string]AllowedType{
			"audio/webm": webm, "audio/ogg": ogg,
			"audio/mp4": mp4, "audio/x-m4a": mp4, "audio/m4a": mp4,
			"audio/wav": wav, "audio/x-wav": wav, "audio/wave": wav,
			"audio/mpeg": mp3, "audio/mp3": mp3,
		},
	}
}

// Validate checks size and type. head should be the first 512 bytes of the file.
func (p UploadPolicy) Validate(declaredType string, size int64, head []byte) (AllowedType, error) {
	if size <= 0 || len(head) == 0 {
		return AllowedType{}, apperr.Validation(map[string]any{"fields": map[string]any{"file": "is empty"}})
	}
	if size > p.MaxBytes {
		return AllowedType{}, apperr.New(apperr.CodePayloadTooLarge,
			"File must be at most "+strconv.FormatInt(p.MaxBytes>>20, 10)+" MB")
	}

	mediaType, _, err := mime.ParseMediaType(declaredType)
	if err != nil {
		return AllowedType{}, apperr.New(apperr.CodeUnsupportedMedia, "File type is not supported")
	}
	allowed, ok := p.Allowed[strings.ToLower(mediaType)]
	if !ok {
		return AllowedType{}, apperr.New(apperr.CodeUnsupportedMedia, "File type is not supported")
	}

	sniffed, _, _ := mime.ParseMediaType(http.DetectContentType(head))
	for _, s := range allowed.Sniffed {
		if sniffed == s {
			return allowed, nil
		}
	}
	return AllowedType{}, apperr.New(apperr.CodeUnsupportedMedia, "File content does not match its declared type")
}
