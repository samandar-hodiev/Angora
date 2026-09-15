"use client";

import { Pause, Play } from "lucide-react";
import { useRef, useState } from "react";

import { IconButton } from "@/components/ui/button";
import { formatDuration } from "@/lib/audio";
import { cn } from "@/lib/utils";

/**
 * Minimal, keyboard-accessible audio player. `floating` renders it as a glass surface for
 * contexts where it hovers over content (e.g. listening exercises on mobile).
 * Give it a `key` tied to the source when the track changes to reset playback state.
 */
export function AudioPlayer({
  src,
  title,
  variant = "inline",
  className,
}: {
  src: string | null;
  title: string;
  variant?: "inline" | "floating";
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const disabled = !src;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl p-3",
        variant === "floating" ? "glass" : "border bg-surface",
        disabled && "opacity-60",
        className,
      )}
    >
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        />
      )}
      <IconButton
        label={playing ? `Pause ${title}` : `Play ${title}`}
        variant="default"
        size="icon"
        className="rounded-full"
        onClick={toggle}
        disabled={disabled}
      >
        {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
      </IconButton>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          disabled={disabled || !duration}
          aria-label={`Seek ${title}`}
          aria-valuetext={`${formatDuration(current * 1000)} of ${formatDuration(duration * 1000)}`}
          onChange={(e) => {
            const audio = audioRef.current;
            if (audio) audio.currentTime = Number(e.target.value);
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-active accent-[var(--primary)] disabled:cursor-not-allowed"
        />
        <div className="flex justify-between text-caption text-fg-muted tabular-nums">
          <span>{formatDuration(current * 1000)}</span>
          <span>{formatDuration(duration * 1000)}</span>
        </div>
      </div>
    </div>
  );
}
