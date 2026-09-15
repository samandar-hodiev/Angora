"use client";

import type { WritingTaskBody } from "@engora/types";
import { Clock, Lightbulb, Lock, Sparkles } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { Meter } from "@/components/ui/data-display";
import { Label } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useContentItem } from "@/features/learning/hooks";

import { ContentPicker, PracticeFrame, useContentSelection } from "./content-picker";

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function WritingView({ initialContentId }: { initialContentId?: string }) {
  const { list, items, current, select } = useContentSelection({ type: "writing_task" }, initialContentId);
  const item = useContentItem<WritingTaskBody>(current?.id);
  const [text, setText] = useState("");
  const [examMode, setExamMode] = useState(false);
  const body = item.data?.body;
  const words = countWords(text);
  const target = body?.min_words ?? 0;

  return (
    <PracticeFrame
      skill="writing"
      title="Writing practice"
      description="Write in a calm, focused space. Feedback comes after you submit."
      list={list}
      emptyTitle="No writing tasks yet"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="task-title" className="grid content-start gap-5 rounded-xl border bg-surface p-6">
          <ContentPicker
            items={items}
            current={current}
            onSelect={(id) => {
              select(id);
              setText("");
            }}
            label="Task"
          />
          <div className="flex flex-wrap gap-2">
            {current?.level && <Badge variant="secondary">{current.level}</Badge>}
            {current?.exam && <Badge variant="outline">{current.exam.toUpperCase()}</Badge>}
            {body?.recommended_minutes && (
              <Badge variant="outline">
                <Clock aria-hidden /> {body.recommended_minutes} min
              </Badge>
            )}
          </div>
          <h2 id="task-title" className="text-h2">
            {current?.title}
          </h2>
          {item.isPending ? <Skeleton className="h-24" /> : <p className="text-body-lg">{body?.prompt}</p>}

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <Label htmlFor="exam-mode" className="grid gap-0.5">
              <span>Exam mode</span>
              <span className="text-caption font-normal text-fg-muted">No hints, like the real test</span>
            </Label>
            <Switch id="exam-mode" checked={examMode} onCheckedChange={setExamMode} />
          </div>

          {examMode ? (
            <p className="flex items-center gap-2 rounded-lg bg-surface-active px-3 py-2.5 text-body-sm text-fg-secondary">
              <Lock className="size-4" aria-hidden /> AI assistance unavailable in exam mode
            </p>
          ) : (
            body?.instructions && (
              <div className="grid gap-2 rounded-lg bg-primary-subtle/60 p-4">
                <p className="flex items-center gap-2 text-label text-primary-subtle-foreground">
                  <Lightbulb className="size-4" aria-hidden /> Checklist
                </p>
                <ul className="grid gap-1.5 text-body-sm">
                  {body.instructions.map((i) => (
                    <li key={i}>• {i}</li>
                  ))}
                </ul>
              </div>
            )
          )}
        </section>

        <section aria-label="Your answer" className="grid content-start gap-3">
          <Label htmlFor="answer" className="sr-only">
            Your answer
          </Label>
          <Textarea
            id="answer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your answer…"
            spellCheck={!examMode}
            className="min-h-[24rem] resize-y p-5 text-body-lg leading-8 md:text-body-lg"
          />
          <div className="grid gap-3 rounded-xl border bg-surface p-4">
            {target > 0 ? (
              <Meter label={`Words: ${words}`} value={words} max={target} display={`target ${target}+`} tone={words >= target ? "success" : "primary"} />
            ) : (
              <p className="text-body-sm">Words: {words}</p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-caption text-fg-muted">Drafts are not saved yet — saving and AI feedback arrive with the writing release.</p>
              <Tooltip content="AI writing feedback arrives in a later release.">
                <span tabIndex={0}>
                  <Button disabled>
                    <Sparkles aria-hidden /> Submit for feedback
                  </Button>
                </span>
              </Tooltip>
            </div>
          </div>
        </section>
      </div>
    </PracticeFrame>
  );
}
