"use client";

import type { ReadingPassageBody } from "@engora/types";
import { Clock } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentItem } from "@/features/learning/hooks";

import { ContentPicker, PracticeFrame, useContentSelection } from "./content-picker";
import { QuestionList } from "./questions";

export function ReadingView({ initialContentId }: { initialContentId?: string }) {
  const { list, items, current, select } = useContentSelection({ type: "reading_passage" }, initialContentId);
  const item = useContentItem<ReadingPassageBody>(current?.id);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const body = item.data?.body;
  // A passage may arrive without questions, or mid-load without a body: read both defensively
  // rather than trusting the shape, or the whole page throws on `.length`.
  const questions = body?.questions ?? [];
  const paragraphs = body?.passage?.split(/\n{2,}/) ?? [];
  const answered = Object.keys(answers).length;

  return (
    <PracticeFrame skill="reading" title="Reading practice" description="Read at your own pace. Questions stay beside the text." list={list} emptyTitle="No reading passages yet">
      <div className="mb-6 max-w-md">
        <ContentPicker
          items={items}
          current={current}
          onSelect={(id) => {
            select(id);
            setAnswers({});
          }}
          label="Passage"
        />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <article aria-labelledby="passage-title" className="rounded-xl border bg-surface p-6 sm:p-10">
          <div className="mb-6 flex flex-wrap gap-2">
            {current?.level && <Badge variant="secondary">{current.level}</Badge>}
            {body?.estimated_minutes && (
              <Badge variant="outline">
                <Clock aria-hidden /> {body.estimated_minutes} min read
              </Badge>
            )}
          </div>
          <h2 id="passage-title" className="mb-6 text-h1">
            {current?.title}
          </h2>
          {item.isPending ? (
            <div className="grid gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5" />
              ))}
            </div>
          ) : (
            <div className="grid max-w-[65ch] gap-5 text-body-lg leading-8 text-foreground">
              {paragraphs.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}
        </article>

        <aside aria-labelledby="questions-title" className="lg:sticky lg:top-20 lg:self-start">
          <div className="grid gap-6 rounded-xl border bg-surface p-6">
            <div className="flex items-center justify-between">
              <h2 id="questions-title" className="text-h3">
                Questions
              </h2>
              {questions.length > 0 && (
                <span className="text-label text-fg-muted tabular-nums">
                  {answered} / {questions.length} answered
                </span>
              )}
            </div>
            {questions.length > 0 ? (
              <QuestionList questions={questions} answers={answers} onAnswer={(q, o) => setAnswers((a) => ({ ...a, [q]: o }))} />
            ) : (
              !item.isPending && <p className="text-body-sm text-fg-muted">This passage has no questions yet.</p>
            )}
            <Tooltip content="Checking answers arrives with the reading release.">
              <span tabIndex={0}>
                <Button className="w-full" disabled>
                  Check answers
                </Button>
              </span>
            </Tooltip>
          </div>
        </aside>
      </div>
    </PracticeFrame>
  );
}
