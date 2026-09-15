"use client";

import { Mic, MicOff, Pause, Play, RotateCcw, Square } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { formatDuration } from "@/lib/audio";
import { cn } from "@/lib/utils";

import { AudioPlayer } from "./audio-player";
import { Waveform } from "./waveform";

/**
 * Speaking recorder: live fluid waveform, timer with limit, pause/resume/finish and
 * playback. `renderSubmit` receives the finished recording so the page decides what to do
 * with it (upload + analysis via the API).
 */
export function AudioRecorder({
  maxDurationMs,
  renderSubmit,
  className,
}: {
  maxDurationMs: number;
  renderSubmit?: (recording: { blob: Blob; mimeType: string; durationMs: number }) => ReactNode;
  className?: string;
}) {
  const recorder = useAudioRecorder({ maxDurationMs });
  const { status, elapsedMs, levels, recording } = recorder;
  const live = status === "recording" || status === "paused";

  if (status === "denied" || status === "unsupported" || status === "error") {
    const message = {
      denied: "Microphone access was blocked. Allow it in your browser's site settings, then try again.",
      unsupported: "This browser can't record audio. Try the latest Chrome, Safari, Edge or Firefox.",
      error: "We couldn't start the microphone. Check that one is connected and not used by another app.",
    }[status];
    return (
      <div role="alert" className={cn("grid justify-items-center gap-3 rounded-xl border bg-surface p-8 text-center", className)}>
        <span className="grid size-12 place-items-center rounded-full bg-error/10 text-error">
          <MicOff className="size-5" aria-hidden />
        </span>
        <p className="max-w-sm text-body-sm text-fg-secondary">{message}</p>
        <Button variant="outline" onClick={recorder.reset}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-6 rounded-xl border bg-surface p-6 sm:p-8", className)}>
      <Waveform levels={levels} active={status === "recording"} label={live ? "Live microphone level" : "Waveform"} />

      <div className="grid justify-items-center gap-1" aria-live="polite">
        <p className="text-h2 tabular-nums">
          {formatDuration(elapsedMs)} <span className="text-fg-muted">/ {formatDuration(maxDurationMs)}</span>
        </p>
        <p className="flex items-center gap-2 text-label text-fg-secondary">
          {status === "recording" && <span className="size-2 animate-breathe rounded-full bg-error motion-reduce:animate-none" aria-hidden />}
          {
            {
              idle: "Ready when you are",
              requesting: "Waiting for microphone permission…",
              recording: "Recording",
              paused: "Paused",
              stopped: "Recording finished",
            }[status]
          }
        </p>
      </div>

      {status === "stopped" && recording && <AudioPlayer src={recording.url} title="your recording" />}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {(status === "idle" || status === "requesting") && (
          <Button size="lg" onClick={() => void recorder.start()} loading={status === "requesting"}>
            <Mic aria-hidden />
            Start recording
          </Button>
        )}
        {status === "recording" && (
          <Button size="lg" variant="outline" onClick={recorder.pause}>
            <Pause aria-hidden />
            Pause
          </Button>
        )}
        {status === "paused" && (
          <Button size="lg" variant="outline" onClick={recorder.resume}>
            <Play aria-hidden />
            Resume
          </Button>
        )}
        {live && (
          <Button size="lg" onClick={recorder.stop}>
            <Square className="fill-current" aria-hidden />
            Finish
          </Button>
        )}
        {status === "stopped" && (
          <>
            <Button size="lg" variant="outline" onClick={recorder.reset}>
              <RotateCcw aria-hidden />
              Record again
            </Button>
            {recording && renderSubmit?.({ blob: recording.blob, mimeType: recording.mimeType, durationMs: elapsedMs })}
          </>
        )}
      </div>
    </div>
  );
}
