"use client";

import { ImageOff, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/errors";
import { apiAssetUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

import { useProfile } from "../hooks";
import { useRemoveWallpaper, useUploadWallpaper } from "../setup-api";
import { measureWallpaperTone, useSaveWallpaper, wallpaperPresets, wallpaperSelection, type WallpaperId } from "../wallpaper";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

function Swatch({ label, preview, selected, onSelect }: { label: string; preview: string | null; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "grid gap-2 rounded-xl border p-1.5 text-left outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/40",
      )}
    >
      <span
        aria-hidden
        className="grid h-16 place-items-center rounded-lg border bg-surface-active bg-cover bg-center"
        style={preview ? { backgroundImage: preview } : undefined}
      >
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
  const customPreview = profile?.wallpaper_url ? `url("${apiAssetUrl(profile.wallpaper_url)}")` : null;

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
      // Measured from the local file: it decides whether text over this photo goes light or
      // dark, so the picture never has to be washed out to stay readable.
      const tone = await measureWallpaperTone(file);
      await upload.mutateAsync(file);
      // The upload only stores the image; this is what puts it on screen.
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
      <div role="radiogroup" aria-label="Background" className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Swatch label="None" preview={null} selected={selection === "none"} onSelect={() => choose("none")} />
        {wallpaperPresets.map((preset) => (
          <Swatch
            key={preset.id}
            label={preset.label}
            preview={preset.image}
            selected={selection === preset.id}
            onSelect={() => choose(preset.id)}
          />
        ))}
        {customPreview && (
          <Swatch label="Your image" preview={customPreview} selected={selection === "custom"} onSelect={() => choose("custom")} />
        )}
      </div>

      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
            {upload.isPending && <Loader2 className="animate-spin" aria-hidden />}
            {profile?.wallpaper_url ? "Change image" : "Upload image"}
          </Button>
          {profile?.wallpaper_url && (
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
