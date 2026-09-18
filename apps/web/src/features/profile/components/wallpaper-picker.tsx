"use client";

import { ImageOff, ImageUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/errors";
import { apiAssetUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

import { useProfile } from "../hooks";
import { useRemoveWallpaper, useUploadWallpaper } from "../setup-api";
import {
  measureWallpaperTone,
  useSaveWallpaper,
  wallpaperPhotoUrl,
  wallpaperPresets,
  wallpaperSelection,
  type WallpaperId,
} from "../wallpaper";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

const tile = "grid gap-2 rounded-xl border p-1.5 text-left outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40";
const thumb = "grid h-16 place-items-center rounded-lg border bg-surface-active bg-cover bg-center";

/** One built-in background. Part of the radio group, so arrow keys walk the set. */
function PresetSwatch({ label, preview, selected, onSelect }: { label: string; preview: string | null; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(tile, selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/40")}
    >
      <span aria-hidden className={thumb} style={preview ? { backgroundImage: preview } : undefined}>
        {!preview && <ImageOff className="size-4 text-fg-muted" />}
      </span>
      <span className="px-1 pb-0.5 text-caption text-fg-secondary">{label}</span>
    </button>
  );
}

/** Background picker: ten built-in gradients, or the learner's own image. */
export function WallpaperPicker() {
  const { data: profile } = useProfile();
  const { save, saveAsync } = useSaveWallpaper();
  const upload = useUploadWallpaper();
  const remove = useRemoveWallpaper();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const selection = wallpaperSelection(profile);
  const photo = profile?.wallpaper_url ? apiAssetUrl(profile.wallpaper_url) : null;

  const choose = (id: WallpaperId) => {
    setError(null);
    save(id);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Choose an image smaller than 8 MB.");
      return;
    }
    try {
      const stored = await upload.mutateAsync(file);
      // The tone decides whether text over this photo goes light or dark, so the picture never
      // has to be washed out to stay readable. The local file is the cheap source; if it cannot
      // be decoded, the stored copy is read instead, and if both fail the layer measures later.
      const tone = (await measureWallpaperTone(file)) ?? (await measureWallpaperTone(wallpaperPhotoUrl(stored) ?? ""));
      // The upload only stores the image; this is what puts it on screen. An unmeasurable photo
      // clears the tone rather than inheriting the previous photo's — the layer re-measures it.
      await saveAsync("custom", tone);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removeImage = async () => {
    setError(null);
    try {
      await remove.mutateAsync(undefined);
      await saveAsync("none");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid gap-5">
      <div role="radiogroup" aria-label="Built-in backgrounds" className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <PresetSwatch label="None" preview={null} selected={selection === "none"} onSelect={() => choose("none")} />
        {wallpaperPresets.map((preset) => (
          <PresetSwatch
            key={preset.id}
            label={preset.label}
            preview={preset.image}
            selected={selection === preset.id}
            onSelect={() => choose(preset.id)}
          />
        ))}
      </div>

      {/* The learner's own image, with everything about it in one place: the picture, the
          actions on it and the formats it accepts. */}
      <div className="grid gap-4 border-t pt-5 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:items-start">
        {photo ? (
          <button
            type="button"
            aria-pressed={selection === "custom"}
            onClick={() => choose("custom")}
            className={cn(tile, selection === "custom" ? "border-primary ring-1 ring-primary" : "hover:border-primary/40")}
          >
            <span aria-hidden className={thumb} style={{ backgroundImage: `url("${photo}")` }} />
            <span className="px-1 pb-0.5 text-caption text-fg-secondary">{selection === "custom" ? "In use" : "Use your image"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className={cn(tile, "border-dashed hover:border-primary/40")}
          >
            <span aria-hidden className={cn(thumb, "border-dashed bg-transparent")}>
              {upload.isPending ? <Loader2 className="size-4 animate-spin text-fg-muted" /> : <ImageUp className="size-5 text-fg-muted" />}
            </span>
            <span className="px-1 pb-0.5 text-caption text-fg-secondary">Upload image</span>
          </button>
        )}

        <div className="grid gap-2">
          <p className="text-label">Your own image</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
              {upload.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {photo ? "Change image" : "Choose image"}
            </Button>
            {photo && (
              <Button type="button" variant="ghost" size="sm" loading={remove.isPending} onClick={() => void removeImage()}>
                Remove image
              </Button>
            )}
          </div>
          <p className="text-caption text-fg-muted">JPG, PNG or WebP, up to 8 MB · shown behind your learning area only</p>
          {error && (
            <p role="alert" className="text-caption text-error">
              {error}
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Background image"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
