"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiAssetUrl } from "@/lib/media";

import { AttemptView } from "./attempt-view";

/**
 * Listening practice.
 *
 * The transcript is hidden by default and one click away. Revealing it is the learner's
 * choice, not a penalty — but it is not shown first, because reading the answer is not
 * listening practice.
 */
export function ListeningView({ initialContentId }: { initialContentId?: string }) {
  return (
    <AttemptView
      skill="listening"
      title="Listening practice"
      description="Play the clip as often as you need. Answers are checked against the key."
      pickerLabel="Clip"
      initialSetId={initialContentId}
      renderStimulus={(body, loading) => <Clip body={body} loading={loading} />}
    />
  );
}

function Clip({ body, loading }: { body: Record<string, unknown>; loading: boolean }) {
  const [showTranscript, setShowTranscript] = useState(false);

  if (loading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  const audioUrl = typeof body.audio_url === "string" ? body.audio_url : null;
  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const duration = typeof body.duration_seconds === "number" ? body.duration_seconds : null;

  return (
    <div className="grid gap-5">
      {audioUrl ? (
        <audio controls className="w-full" src={apiAssetUrl(audioUrl) ?? undefined}>
          Your browser cannot play this clip.
        </audio>
      ) : (
        <div className="grid gap-1 rounded-lg border border-dashed px-4 py-3">
          <p className="text-body-sm text-fg-secondary">
            This clip has no audio file yet — the transcript below is the exercise for now.
          </p>
          {duration !== null && <p className="text-caption text-fg-muted">Recorded length: {duration} seconds</p>}
        </div>
      )}

      {transcript && (
        <div className="grid justify-items-start gap-3">
          <Button variant="outline" size="sm" onClick={() => setShowTranscript((shown) => !shown)}>
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </Button>
          {showTranscript && (
            <div className="grid max-w-[65ch] gap-4 text-body leading-7 text-fg-secondary">
              {transcript.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
