"use client";

import type { SpeakingTopicBody } from "@engora/types";
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import Link from "next/link";

import { AudioRecorder } from "@/components/learning/audio-recorder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentItem } from "@/features/learning/hooks";
import { useCurrentSubscription } from "@/features/subscription/hooks";

import { ContentPicker, PracticeFrame, useContentSelection } from "./content-picker";

export function SpeakingView({ initialContentId }: { initialContentId?: string }) {
  const { list, items, current, select } = useContentSelection({ type: "speaking_topic" }, initialContentId);
  const item = useContentItem<SpeakingTopicBody>(current?.id);
  const subscription = useCurrentSubscription();
  const limit = subscription.data?.entitlements.limits["speaking.evaluations"];
  const body = item.data?.body;
  const seconds = body?.speaking_seconds ?? 120;

  return (
    <PracticeFrame
      skill="speaking"
      title="Speaking practice"
      description="Answer out loud. Take your time — you can pause and record again."
      list={list}
      emptyTitle="No speaking topics yet"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section aria-labelledby="topic-title" className="grid content-start gap-5 rounded-xl border bg-surface p-6">
          <ContentPicker items={items} current={current} onSelect={select} label="Topic" />
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {current?.level && <Badge variant="secondary">{current.level}</Badge>}
              {current?.exam && <Badge variant="outline">{current.exam.toUpperCase()}</Badge>}
              <Badge variant="outline">
                <Clock aria-hidden /> {Math.round(seconds / 60)} minutes
              </Badge>
            </div>
            <p className="text-label text-fg-muted">Topic</p>
            <h2 id="topic-title" className="text-h2">
              {current?.title}
            </h2>
          </div>
          {item.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <p className="text-body-lg">{body?.prompt}</p>
              {body?.guidance && body.guidance.length > 0 && (
                <div className="grid gap-2">
                  <p className="text-label text-fg-muted">You could talk about</p>
                  <ul className="grid gap-1.5 text-body-sm text-fg-secondary">
                    {body.guidance.map((g) => (
                      <li key={g} className="flex gap-2">
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        <section aria-label="Recorder" className="grid content-start gap-4">
          <AudioRecorder
            key={current?.id}
            maxDurationMs={seconds * 1000}
            renderSubmit={() => (
              <Tooltip content="AI speaking analysis arrives in the next release.">
                <span tabIndex={0}>
                  <Button size="lg" disabled>
                    <Sparkles aria-hidden />
                    Get AI feedback
                  </Button>
                </span>
              </Tooltip>
            )}
          />
          <div className="flex flex-col gap-2 text-body-sm text-fg-secondary sm:flex-row sm:items-center sm:justify-between">
            <span>
              {limit
                ? limit.limit === null
                  ? "Unlimited AI speaking evaluations on your plan"
                  : `${limit.remaining ?? 0} of ${limit.limit} AI evaluations left today`
                : " "}
            </span>
            <Link href="/app/speaking/example" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              See an example analysis <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </div>
    </PracticeFrame>
  );
}
