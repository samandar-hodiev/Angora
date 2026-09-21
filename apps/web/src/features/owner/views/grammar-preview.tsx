"use client";

import { Image as ImageIcon, MessageCircleQuestion, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";

import type { ContentLanguage, GrammarSectionKey, GrammarTopicDetail } from "../types";
import { languageNames } from "../lib/format";

/**
 * What the learner will see.
 *
 * A faithful rehearsal of the learner topic page (features/grammar/components/topic-view) —
 * same order, same sections, same emphasis — rendered from the draft the Owner is editing so
 * publishing never produces a surprise. It reads the draft directly and renders nothing
 * interactive: this is a rehearsal, not the real lesson.
 */
export function GrammarLearnerPreview({
  topic,
  language,
}: {
  topic: GrammarTopicDetail;
  language: ContentLanguage;
}) {
  const localized = topic.content[language];
  const section = (key: GrammarSectionKey) => localized?.sections.find((entry) => entry.key === key);

  if (!localized || localized.status === "missing") {
    return (
      <div className="rounded-xl border border-dashed bg-surface p-8 text-center">
        <p className="text-h4">No {languageNames[language]} lesson yet</p>
        <p className="mt-1 text-body-sm text-fg-secondary">
          Generate or write the {languageNames[language]} explanation to preview it here.
        </p>
      </div>
    );
  }

  const rule = section("rule");
  const formula = section("formula");
  const usage = section("usage");
  const examples = section("examples");
  const signals = section("signal_words");
  const mistakes = section("common_mistakes");
  const dontForget = section("dont_forget");
  const exceptions = section("exceptions");
  const tips = section("tips");
  const related = section("related");

  return (
    <div className="rounded-xl border bg-background p-5 sm:p-8">
      <p className="mb-4 text-caption text-fg-muted">Learner view · {languageNames[language]} explanation</p>

      <article className="grid max-w-3xl gap-8">
        <header className="grid gap-2">
          <h1 className="text-h1">{topic.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
            <Badge variant="outline">{topic.level}</Badge>
            <span>{topic.category_name}</span>
            <span aria-hidden>·</span>
            <span>{topic.estimated_minutes} min</span>
            {topic.ielts_relevant && <Badge variant="secondary">IELTS</Badge>}
          </p>
        </header>

        {rule && (rule.body || rule.items.length > 0) && (
          <section className="grid gap-3">
            <h2 className="text-h3">What is {topic.name}?</h2>
            {rule.body.split("\n\n").map((paragraph, index) => (
              <p key={index} className="text-body">
                {paragraph}
              </p>
            ))}
          </section>
        )}

        {formula && formula.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Form</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {formula.items.map((item) => {
                const [label, pattern] = item.includes(":") ? item.split(/:(.+)/) : ["Pattern", item];
                return (
                  <div key={item} className="grid gap-1.5 rounded-xl border bg-surface p-4">
                    <p className="text-label text-fg-muted">{label}</p>
                    <p className="font-mono text-body-sm">{pattern?.trim()}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {usage && usage.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">When do we use it?</h2>
            <ul className="grid gap-2">
              {usage.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-body">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {signals && signals.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Signal words</h2>
            <ul className="flex flex-wrap gap-2">
              {signals.items.map((word) => (
                <li key={word}>
                  <Badge variant="outline" className="px-2.5 py-1 text-body-sm">
                    {word}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        {examples && examples.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Examples</h2>
            <ul className="divide-y rounded-xl border bg-surface">
              {examples.items.map((example) => (
                <li key={example} className="px-4 py-3 text-body">
                  {example}
                </li>
              ))}
            </ul>
          </section>
        )}

        {mistakes && mistakes.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Common mistakes</h2>
            <ul className="grid gap-2">
              {mistakes.items.map((item) => (
                <li key={item} className="rounded-xl border bg-surface p-4 text-body-sm">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {dontForget && dontForget.body && (
          <section className="rounded-xl border border-warning/40 bg-warning/10 p-4">
            <h2 className="text-h4">Don&apos;t forget</h2>
            <p className="mt-1 text-body-sm">{dontForget.body}</p>
          </section>
        )}

        {exceptions && exceptions.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Exceptions</h2>
            <ul className="grid gap-2">
              {exceptions.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-body-sm">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tips && tips.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Tips</h2>
            <ul className="grid gap-2">
              {tips.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-body-sm">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid gap-3">
          <h2 className="text-h3">Go deeper</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1 rounded-xl border bg-surface p-4">
              <p className="flex items-center gap-2 text-label">
                <ImageIcon className="size-4 text-primary" aria-hidden />
                Visualize this rule
              </p>
              <p className="text-caption text-fg-muted">
                {topic.has_visual ? "A timeline is available for this topic." : "No visual generated yet."}
              </p>
            </div>
            <div className="grid gap-1 rounded-xl border bg-surface p-4">
              <p className="flex items-center gap-2 text-label">
                <MessageCircleQuestion className="size-4 text-primary" aria-hidden />
                Ask the AI tutor
              </p>
              <p className="text-caption text-fg-muted">
                {topic.has_ai_tutor ? "Premium learners can ask follow-up questions." : "Not enabled for this topic."}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-xl border bg-surface p-5">
          <h2 className="text-h3">Practice</h2>
          <p className="text-body-sm text-fg-secondary">
            {topic.question_count > 0
              ? `${topic.question_count} questions. Answers are marked instantly and weak points are tracked.`
              : "No practice questions on this topic yet."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled>Practise this topic</Button>
            <Button variant="outline" disabled>
              Test mode
            </Button>
          </div>
          <p className="text-caption text-fg-muted">Practice is disabled inside the preview.</p>
        </section>

        <section className="grid gap-3">
          <h2 className="text-h3">Your progress</h2>
          <div className="grid gap-3 rounded-xl border bg-surface p-4">
            <Meter label="Mastery" value={0} display="Not started" />
            <p className="text-caption text-fg-muted">
              Each learner sees their own mastery, attempts and last practice date here.
            </p>
          </div>
        </section>

        {related && related.items.length > 0 && (
          <section className="grid gap-3">
            <h2 className="text-h3">Related grammar</h2>
            <ul className="flex flex-wrap gap-2">
              {related.items.map((item) => (
                <li key={item}>
                  <Badge variant="secondary" className="px-2.5 py-1 text-body-sm">
                    {item}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}
