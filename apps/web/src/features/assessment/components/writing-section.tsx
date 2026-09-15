"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useAnswerSaver, useCountdown } from "../use-section-timing";

import type { SectionProps } from "./section-runner";
import { ConfirmDialog, SaveIndicator, SectionHeader } from "./section-parts";

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Writing task. During the assessment Engora gives no corrections, suggestions or hints, and
 * browser spell-check/grammar extensions are disabled on the editor. The draft autosaves.
 */
export function WritingSection({ assessment, content, receivedAt, onSubmit, submitting }: SectionProps) {
  const { section } = content;
  const item = content.items[0]!;
  const editorId = useId();
  const saver = useAnswerSaver(assessment.id, "writing");
  const [text, setText] = useState(() => content.answers.find((a) => a.item_id === item.id)?.response.text ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const words = countWords(text);
  const minWords = item.settings.min_words ?? 0;
  const maxWords = item.settings.max_words;

  const finish = async () => {
    setConfirmOpen(false);
    saver.save(item.id, { text });
    await saver.flush();
    onSubmit();
  };

  const remaining = useCountdown({
    deadlineAt: section.deadline_at,
    serverTime: content.server_time,
    receivedAt,
    onExpire: () => void finish(),
  });

  // Warn before closing the tab while a change is not yet saved.
  useEffect(() => {
    if (saver.state !== "saving" && saver.state !== "error") return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saver.state]);

  return (
    <div className="grid gap-5 py-4 sm:py-6">
      <SectionHeader
        section={section}
        sectionCount={assessment.sections.length}
        label={`${words} ${words === 1 ? "word" : "words"}`}
        remainingMs={remaining}
        progress={minWords > 0 ? Math.min(100, (words / minWords) * 100) : 0}
        saveState={saver.state}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
        <section aria-labelledby="writing-task" className="journey-card grid gap-4 rounded-2xl p-5 sm:p-6 lg:sticky lg:top-28">
          <p className="text-label text-fg-muted">Writing task</p>
          <h2 id="writing-task" className="text-h3 text-balance">
            {item.prompt}
          </h2>
          {item.settings.instructions && item.settings.instructions.length > 0 && (
            <ul className="grid gap-1.5 text-body-sm text-fg-secondary">
              {item.settings.instructions.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          )}
          {minWords > 0 && (
            <p className="rounded-lg bg-surface/50 px-3 py-2 text-body-sm">
              Write {minWords}
              {maxWords ? `–${maxWords}` : "+"} words.
            </p>
          )}
        </section>

        <div className="journey-card grid gap-3 rounded-2xl p-4 sm:p-5">
          <label htmlFor={editorId} className="text-label">
            Your answer
          </label>
          <Textarea
            id={editorId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              saver.save(item.id, { text: e.target.value }, 0, 1200);
            }}
            onBlur={() => void saver.flush()}
            rows={14}
            spellCheck={false}
            autoCorrect="off"
            autoComplete="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            className="min-h-[18rem] resize-y bg-background/40 text-body leading-relaxed"
          />
          <div className="flex items-center justify-between gap-3 text-caption">
            <span className={cn("tabular-nums", words < minWords ? "text-fg-muted" : "text-primary")} aria-live="polite">
              {words} {words === 1 ? "word" : "words"}
              {minWords > 0 && ` · aim for ${minWords}${maxWords ? `–${maxWords}` : "+"}`}
            </span>
            <span className="sm:hidden">
              <SaveIndicator state={saver.state} />
            </span>
            <span className="text-fg-muted">No spell-check or hints during the test</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="liquid" size="lg" loading={submitting} onClick={() => (words < minWords ? setConfirmOpen(true) : void finish())}>
          Submit writing
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Submit a shorter answer?"
        description={`Your answer has ${words} words. The task asks for at least ${minWords}, and short answers score lower.`}
        confirmLabel="Submit anyway"
        onConfirm={() => void finish()}
      />
    </div>
  );
}
