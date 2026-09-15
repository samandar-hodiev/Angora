package storage

// ImagePolicy covers profile photos from browsers and mobile photo pickers. HEIC must be
// converted client-side (iOS pickers can export JPEG).
func ImagePolicy(maxBytes int64) UploadPolicy {
	jpeg := AllowedType{Canonical: "image/jpeg", Extension: ".jpg", Sniffed: []string{"image/jpeg"}}
	png := AllowedType{Canonical: "image/png", Extension: ".png", Sniffed: []string{"image/png"}}
	webp := AllowedType{Canonical: "image/webp", Extension: ".webp", Sniffed: []string{"image/webp"}}
	return UploadPolicy{
		MaxBytes: maxBytes,
		Allowed: map[string]AllowedType{
			"image/jpeg": jpeg, "image/jpg": jpeg, "image/png": png, "image/webp": webp,
		},
	}
}
