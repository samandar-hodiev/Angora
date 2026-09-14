package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"time"
)

// Local stores objects on disk. Development only: it does not scale across instances and
// cannot issue presigned URLs.
type Local struct {
	root string
}

func NewLocal(root string) (*Local, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o750); err != nil {
		return nil, fmt.Errorf("create storage dir: %w", err)
	}
	return &Local{root: abs}, nil
}

func (*Local) Provider() string { return "local" }

func (l *Local) path(key string) (string, error) {
	if err := ValidateKey(key); err != nil {
		return "", err
	}
	return filepath.Join(l.root, filepath.FromSlash(key)), nil
}

func (l *Local) Put(_ context.Context, key string, body io.Reader, _ int64, _ string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		return err
	}
	// Write to a temp file and rename, so readers never see a partial object.
	tmp, err := os.CreateTemp(filepath.Dir(p), ".upload-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, body); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), p)
}

func (l *Local) Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	info, err := l.Stat(ctx, key)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	p, _ := l.path(key)
	f, err := os.Open(p)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	return f, info, nil
}

func (l *Local) Stat(_ context.Context, key string) (ObjectInfo, error) {
	p, err := l.path(key)
	if err != nil {
		return ObjectInfo{}, err
	}
	st, err := os.Stat(p)
	if errors.Is(err, fs.ErrNotExist) {
		return ObjectInfo{}, ErrNotFound
	}
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{
		Key:          key,
		Size:         st.Size(),
		ContentType:  mime.TypeByExtension(filepath.Ext(p)),
		LastModified: st.ModTime(),
	}, nil
}

func (l *Local) Delete(_ context.Context, key string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

func (*Local) PresignPut(context.Context, string, string, time.Duration) (PresignedRequest, error) {
	return PresignedRequest{}, ErrPresignUnsupported
}

func (*Local) PresignGet(context.Context, string, time.Duration) (PresignedRequest, error) {
	return PresignedRequest{}, ErrPresignUnsupported
}
