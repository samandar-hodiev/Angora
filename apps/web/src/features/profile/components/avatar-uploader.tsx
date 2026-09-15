"use client";

import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage, initials } from "@/components/ui/overlay";
import { errorMessage } from "@/lib/api/errors";
import { apiAssetUrl } from "@/lib/media";

import { useRemoveAvatar, useUploadAvatar } from "../setup-api";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Optional profile photo: upload, preview, change or remove. Stored in object storage via the API. */
export function AvatarUploader({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Choose an image smaller than 5 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    try {
      await upload.mutateAsync(file);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPreview(null);
      URL.revokeObjectURL(url);
    }
  };

  const src = preview ?? apiAssetUrl(avatarUrl);

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <Avatar className="size-18 border">
          {src && <AvatarImage src={src} alt="" className="object-cover" />}
          <AvatarFallback className="text-h3">{name.trim() ? initials(name) : <Camera className="size-6 text-fg-muted" aria-hidden />}</AvatarFallback>
        </Avatar>
        {upload.isPending && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-background/60" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <span className="sr-only">Uploading photo</span>
          </span>
        )}
      </div>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            {avatarUrl ? "Change photo" : "Upload photo"}
          </Button>
          {avatarUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={remove.isPending}
              onClick={() => {
                setError(null);
                remove.mutate(undefined, { onError: (err) => setError(errorMessage(err)) });
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <p className="text-caption text-fg-muted">Optional · JPG, PNG or WebP, up to 5 MB</p>
        {error && (
          <p role="alert" className="text-caption text-error">
            {error}
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Profile photo"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
