"use client";

import { Skeleton } from "@/components/ui/skeleton";

import { AttemptView } from "./attempt-view";

/**
 * Reading practice.
 *
 * The passage stays whole and unhurried on the left; the questions sit beside it rather than
 * after it, so checking a detail never means losing your place. Marking is the API's job.
 */
export function ReadingView({ initialContentId }: { initialContentId?: string }) {
  return (
    <AttemptView
      skill="reading"
      title="Reading practice"
      description="Read at your own pace. Questions stay beside the text, and answers are checked against the key."
      pickerLabel="Passage"
      initialSetId={initialContentId}
      renderStimulus={(body, loading) => {
        if (loading) {
          return (
            <div className="grid gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5" />
              ))}
            </div>
          );
        }
        const passage = typeof body.passage === "string" ? body.passage : "";
        return (
          <div className="grid max-w-[65ch] gap-5 text-body-lg leading-8 text-foreground">
            {passage.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        );
      }}
    />
  );
}
