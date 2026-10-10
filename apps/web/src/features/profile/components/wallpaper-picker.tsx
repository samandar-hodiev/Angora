"use client";

import type { Profile } from "@engora/types";
import { useQueryClient } from "@tanstack/react-query";
import { ImageOff, ImageUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api/errors";
import { apiAssetUrl } from "@/lib/media";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";

import { useProfile } from "../hooks";
import { AuroraCurtain, isAurora } from "./wallpaper-layer";
import { useRemoveWallpaper, useUploadWallpaper } from "../setup-api";
import {
  defaultMotion,
  learnerPresets,
  measureWallpaperTone,
  useSaveWallpaper,
  wallpaperDim,
  wallpaperMotion,
  wallpaperPhotoUrl,
  wallpaperSelection,
  type WallpaperId,
  type WallpaperMotion,
} from "../wallpaper";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

const tile = "grid content-start gap-2 rounded-xl border p-1.5 text-left transition-colors duration-micro";
const focus = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";
const thumb = "relative grid h-16 place-items-center overflow-clip rounded-lg border bg-surface-active";

/**
 * Live or still, under every background. Choosing one also picks the background it sits under,
 * so a learner can go straight to "Dusk, moving" in one click.
 */
function MotionToggle({ label, active, onChoose }: { label: string; active: WallpaperMotion | null; onChoose: (motion: WallpaperMotion) => void }) {
  const options: [WallpaperMotion, string][] = [
    ["live", "Live"],
    ["still", "Still"],
  ];
  return (
    <div role="group" aria-label={`${label}: motion`} className="grid grid-cols-2 gap-1 rounded-lg bg-surface-active p-0.5">
      {options.map(([value, text]) => (
        <button
          key={value}
          type="button"
          aria-pressed={active === value}
          onClick={() => onChoose(value)}
          className={cn(
            focus,
            "flex h-7 min-w-0 items-center justify-center rounded-md px-1 text-caption transition-colors duration-micro",
            active === value ? "bg-primary text-primary-foreground shadow-sm" : "text-fg-secondary hover:bg-surface-hover hover:text-fg-primary",
          )}
        >
          <span className="truncate">{text}</span>
        </button>
      ))}
    </div>
  );
}

/** One built-in background: its preview (part of the radio group) and its motion choice. */
function PresetSwatch({
  label,
  preview,
  aurora,
  live,
  selected,
  motion,
  onSelect,
  onMotion,
}: {
  label: string;
  preview: string | null;
  aurora?: boolean;
  live: boolean;
  selected: boolean;
  /** Shown as chosen only on the background in use. */
  motion: WallpaperMotion | null;
  onSelect: () => void;
  onMotion?: (motion: WallpaperMotion) => void;
}) {
  return (
    <div className={cn(tile, selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/40")}>
      <button type="button" role="radio" aria-checked={selected} onClick={onSelect} className={cn(focus, "grid gap-2 rounded-lg text-left")}>
        {/* The preview moves the way the background will, so what the swatch shows is what the area gets. */}
        <span aria-hidden className={thumb}>
          {preview ? (
            <span
              className={cn("absolute bg-cover bg-center", live && !aurora ? "-inset-[6%] wallpaper-drift" : "inset-0")}
              style={{ backgroundImage: preview }}
            />
          ) : (
            <ImageOff className="size-4 text-fg-muted" />
          )}
          {aurora && <AuroraCurtain still={!live} />}
        </span>
        <span className="px-1 text-caption text-fg-secondary">{label}</span>
      </button>
      {onMotion && <MotionToggle label={label} active={motion} onChoose={onMotion} />}
    </div>
  );
}

/**
 * How far the background is dimmed. The value is applied to the real background while the
 * thumb moves — the profile in the cache is updated in place — and saved once, on release.
 */
function DimSlider({ profile, onCommit }: { profile: Profile | undefined; onCommit: (dim: number) => void }) {
  const queryClient = useQueryClient();
  const saved = wallpaperDim(profile);
  const [value, setValue] = useState(saved);
  const dragging = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follows the stored value (another tab, another device) unless the learner is mid-drag.
  useEffect(() => {
    if (!dragging.current) setValue(saved);
  }, [saved]);

  const preview = (next: number) => {
    setValue(next);
    queryClient.setQueryData<Profile>(queryKeys.profile.me, (current) =>
      current ? { ...current, preferences: { ...current.preferences, wallpaper_dim: next } } : current,
    );
  };
  // Saved once the learner stops: arrow keys fire a keyup per step, and a request per step
  // could land out of order and put an older value back.
  const commit = () => {
    dragging.current = false;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => onCommit(value), 400);
  };


  return (
    <div className="grid gap-2 border-t pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor="wallpaper-dim">Dim the background</Label>
        <span className="text-label tabular-nums text-fg-secondary">{value}%</span>
      </div>
      <input
        id="wallpaper-dim"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-valuetext={`${value}%`}
        className={cn("wallpaper-range", focus)}
        style={{ "--fill": `${value}%` } as CSSProperties}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => preview(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <p className="text-caption text-fg-muted">0% shows the picture as it is; raise it to calm the picture behind your lessons.</p>
    </div>
  );
}

/** Background picker: the built-in gradients and flower scenes, or the learner's own image. */
export function WallpaperPicker() {
  const { data: profile } = useProfile();
  const { save, saveAsync, saveWithMotion, saveDim } = useSaveWallpaper();
  const upload = useUploadWallpaper();
  const remove = useRemoveWallpaper();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const selection = wallpaperSelection(profile);
  const motion = wallpaperMotion(profile);
  const photo = profile?.wallpaper_url ? apiAssetUrl(profile.wallpaper_url) : null;

  const choose = (id: WallpaperId) => {
    setError(null);
    save(id);
  };
  const chooseMoving = (id: WallpaperId, next: WallpaperMotion) => {
    setError(null);
    saveWithMotion(id, next);
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
      <div role="radiogroup" aria-label="Built-in backgrounds" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <PresetSwatch label="None" preview={null} live={false} motion={null} selected={selection === "none"} onSelect={() => choose("none")} />
        {learnerPresets.map((preset) => {
          const selected = selection === preset.id;
          return (
            <PresetSwatch
              key={preset.id}
              label={preset.label}
              preview={preset.image}
              aurora={isAurora(preset)}
              live={(selected ? motion : defaultMotion(preset)) === "live"}
              motion={selected ? motion : null}
              selected={selected}
              onSelect={() => choose(preset.id)}
              onMotion={(next) => chooseMoving(preset.id, next)}
            />
          );
        })}
      </div>

      {/* The learner's own image, with everything about it in one place: the picture, the
          actions on it and the formats it accepts. */}
      <div className="grid gap-4 border-t pt-5 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:items-start">
        {photo ? (
          <PresetSwatch
            label={selection === "custom" ? "In use" : "Use your image"}
            preview={`url("${photo}")`}
            live={selection === "custom" && motion === "live"}
            motion={selection === "custom" ? motion : null}
            selected={selection === "custom"}
            onSelect={() => choose("custom")}
            onMotion={(next) => chooseMoving("custom", next)}
          />
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className={cn(tile, focus, "border-dashed hover:border-primary/40")}
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

      {selection !== "none" && <DimSlider profile={profile} onCommit={saveDim} />}

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
