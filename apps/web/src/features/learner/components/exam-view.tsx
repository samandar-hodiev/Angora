"use client";

import type { WritingTaskBody } from "@engora/types";
import { Clock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/common/brand";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useContentItem, useContentList } from "@/features/learning/hooks";
import { countWords } from "@/features/practice/writing-view";
import { formatDuration } from "@/lib/audio";
import { cn } from "@/lib/utils";

/**
 * IELTS exam mode: intentionally plain. No navigation, glass, liquid effects, animation or
 * AI hints — only the task, a timer, progress and the answer area.
 */
export function ExamView({ contentId }: { contentId?: string }) {
  const router = useRouter();
  const list = useContentList({ exam: "ielts", type: "writing_task" });
  const id = contentId ?? list.data?.items[0]?.id;
  const item = useContentItem<WritingTaskBody>(id);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [text, setText] = useState("");

  const limitMs = (item.data?.body.recommended_minutes ?? 40) * 60_000;
  const remaining = startedAt ? Math.max(0, limitMs - (now - startedAt)) : limitMs;

  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const body = item.data?.body;
  const timeUp = startedAt !== null && remaining === 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <BrandMark />
          <p className="text-h4">IELTS Writing · Task 2</p>
          <span className="hidden text-body-sm text-fg-muted sm:inline">Task 1 of 1</span>
          <div
            role="timer"
            aria-live={remaining < 60_000 ? "assertive" : "off"}
            className={cn("ml-auto flex items-center gap-2 rounded-md border px-3 py-1 text-label tabular-nums", remaining < 5 * 60_000 && startedAt && "border-error/50 text-error")}
          >
            <Clock className="size-4" aria-hidden />
            {formatDuration(remaining)}
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <X aria-hidden /> Exit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Leave the exam?</DialogTitle>
                <DialogDescription>Your answer won&apos;t be saved and the timer will reset.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Keep going</Button>
                </DialogClose>
                <Button variant="destructive" onClick={() => router.push("/app/ielts")}>
                  Leave exam
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {list.isError || item.isError ? (
          <ErrorState error={list.error ?? item.error} onRetry={() => void list.refetch()} />
        ) : !body ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : !startedAt ? (
          <section className="mx-auto grid max-w-xl gap-6 rounded-xl border bg-surface p-8">
            <h1 className="text-h2">Before you start</h1>
            <ul className="grid gap-2 text-body text-fg-secondary">
              <li>• You have {body.recommended_minutes ?? 40} minutes. The timer starts when you begin.</li>
              <li>• Write at least {body.min_words ?? 250} words.</li>
              <li>• AI assistance and spell-check are turned off.</li>
            </ul>
            <Button size="lg" onClick={() => setStartedAt(Date.now())}>
              Start exam
            </Button>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section aria-labelledby="exam-task" className="rounded-xl border bg-surface p-6 lg:sticky lg:top-20 lg:self-start">
              <h1 id="exam-task" className="mb-4 text-label text-fg-muted">
                Task
              </h1>
              <p className="text-body-lg">{body.prompt}</p>
              <p className="mt-4 text-body-sm text-fg-muted">Write at least {body.min_words ?? 250} words.</p>
            </section>
            <section className="grid content-start gap-3">
              <Label htmlFor="exam-answer" className="sr-only">
                Your answer
              </Label>
              <Textarea
                id="exam-answer"
                value={text}
                onChange={(e) => setText(e.target.value)}
                readOnly={timeUp}
                spellCheck={false}
                autoCorrect="off"
                className="min-h-[28rem] p-5 text-body-lg leading-8 md:text-body-lg"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-fg-muted tabular-nums">Words: {countWords(text)}</span>
                <Tooltip content="Submitting mock exams arrives with IELTS mode.">
                  <span tabIndex={0}>
                    <Button disabled>{timeUp ? "Time is up" : "Submit"}</Button>
                  </span>
                </Tooltip>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
