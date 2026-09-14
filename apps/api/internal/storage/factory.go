package storage

import (
	"fmt"

	"github.com/samandar-hodiev/engora/apps/api/config"
)

// New selects the storage backend from configuration.
func New(cfg config.StorageConfig) (ObjectStorage, error) {
	switch cfg.Provider {
	case "local":
		return NewLocal(cfg.LocalDir)
	case "s3":
		return NewS3(S3Options{
			Bucket: cfg.Bucket, Region: cfg.Region, Endpoint: cfg.Endpoint,
			AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey,
		})
	default:
		return nil, fmt.Errorf("unsupported storage provider %q", cfg.Provider)
	}
}
