"use client";

import { CircleAlert, Image as ImageIcon, Lightbulb, Lock, MessageCircle, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { InlineLoader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, isApiError, type ApiError } from "@/lib/api/errors";
import { apiAssetUrl } from "@/lib/media";
import type { GrammarExplanationResponse, GrammarVisual } from "@engora/types";

import { useGrammarExplanation, useGrammarTutor, useGrammarVisual } from "../hooks";
import { AIBadge } from "./shared";

/**
 * The AI surfaces of a topic page.
 *
 * All three are opt-in: nothing here runs until the learner asks for it. That is a cost
 * decision, but mostly an editorial one — the canonical rule above is what the product
 * teaches, and these are help around it, clearly marked as generated.
 *
 * When one of them fails, it fails alone. The rule, the examples and the practice are all
 * still on the page, and the error says so.
 */

export function AIFailure({ error, what }: { error: unknown; what: string }) {
  // A plan refusal is not a fault. The API answers ENTITLEMENT_REQUIRED when the feature is
  // not part of the learner's plan and USAGE_LIMIT_REACHED when their budget for the period
  // is spent; telling them "temporarily unavailable" for either would be a lie, and would
  // hide the one thing they can act on.
  if (isApiError(error) && (error.code === "ENTITLEMENT_REQUIRED" || error.code === "USAGE_LIMIT_REACHED")) {
    return <AIUpgradePrompt error={error} what={what} />;
  }

  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-dashed px-4 py-3">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="text-body-sm text-fg-secondary">
        {errorMessage(error) || `${what} is temporarily unavailable.`}
      </p>
    </div>
  );
}

/** What a learner sees when their plan, or their budget for this month, stops here. */
function AIUpgradePrompt({ error, what }: { error: ApiError; what: string }) {
  const spent = error.code === "USAGE_LIMIT_REACHED";
  const resetsAt = typeof error.details?.resets_at === "string" ? error.details.resets_at : null;

  return (
    <div className="grid gap-3 rounded-lg border border-primary/30 bg-primary-subtle/40 px-4 py-3.5">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="grid gap-0.5">
          <p className="text-label">{spent ? `You have used all of your ${what.toLowerCase()} this month` : `${what} is part of a paid plan`}</p>
          <p className="text-body-sm text-fg-secondary">
            {spent
              ? resetsAt
                ? `Your allowance returns on ${new Date(resetsAt).toLocaleDateString()}. Upgrade to keep going now.`
                : "Upgrade to keep going now."
              : "Everything above — the rule, the examples and the practice — stays free."}
          </p>
        </div>
      </div>
      <Button size="sm" variant="subtle" className="w-fit" asChild>
        <Link href="/app/subscription">See plans</Link>
      </Button>
    </div>
  );
}

/**
 * The generated lesson.
 *
 * It loads with the topic rather than behind a button. For the topics that already have a
 * curated rule this is a second pass over it, written for this learner's level; for the ones
 * that do not, it is the lesson itself — which is why it is long-form and why it is not
 * hidden behind an interaction.
 */
export function ExplainPanel({
  slug,
  level,
  isPrimary,
}: {
  slug: string;
  level: string | null;
  /** True when the topic has no curated text, so this is the only explanation on the page. */
  isPrimary?: boolean;
}) {
  const explain = useGrammarExplanation(slug);
  const data = explain.data as GrammarExplanationResponse | undefined;

  if (explain.isPending) {
    return (
      <div className="grid gap-3 rounded-xl border bg-surface p-5">
        <InlineLoader label={`Writing the explanation${level ? ` for ${level}` : ""}…`} />
        <p className="text-caption text-fg-muted">
          The first time a topic is opened this is generated; after that it is instant.
        </p>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (explain.isError || !data) {
    return (
      <div className="grid gap-3">
        <AIFailure error={explain.error} what="The AI explanation" />
        {isPrimary && (
          <p className="text-body-sm text-fg-muted">
            The topic&apos;s related forms, comparisons and practice below still work.
          </p>
        )}
        <div>
          <Button variant="outline" size="sm" onClick={() => void explain.refetch()}>
            <Sparkles aria-hidden />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const e = data.explanation;

  return (
    <article className="grid gap-6 rounded-xl border bg-surface p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <h3 className="text-h3">{isPrimary ? "The rule" : "Explained for you"}</h3>
        <span className="flex items-center gap-2">
          {data.level && <Badge variant="outline">{data.level}</Badge>}
          <AIBadge cached={data.cached} />
        </span>
      </header>

      {e.summary && <p className="text-body-lg text-fg-secondary">{e.summary}</p>}

      {e.paragraphs?.length > 0 && (
        <div className="grid gap-3">
          {e.paragraphs.map((paragraph, i) => (
            <p key={i} className="text-body">
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {e.formulas?.length > 0 && (
        <Section title="Form">
          <div className="grid gap-2 sm:grid-cols-2">
            {e.formulas.map((f, i) => (
              <div key={i} className="grid gap-1.5 rounded-lg border bg-background p-3">
                <p className="text-label text-fg-muted">{f.label}</p>
                <p className="font-mono text-body-sm">{f.pattern}</p>
                {f.examples?.length > 0 && (
                  <ul className="grid gap-0.5 border-t pt-1.5">
                    {f.examples.map((ex, j) => (
                      <li key={j} className="text-body-sm text-fg-secondary">
                        {ex}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {e.when_to_use?.length > 0 && (
        <Section title="When to use it">
          <ul className="grid gap-2.5">
            {e.when_to_use.map((item, i) => (
              <li key={i} className="grid gap-0.5">
                <span className="flex items-start gap-2 text-body">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {item.use}
                </span>
                {item.example && <span className="pl-3.5 text-body-sm text-fg-secondary">{item.example}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {e.examples?.length > 0 && (
        <Section title="Examples">
          <ul className="divide-y rounded-lg border">
            {e.examples.map((ex, i) => (
              <li key={i} className="grid gap-0.5 px-3 py-2.5">
                <p className="text-body">{ex.sentence}</p>
                {ex.note && <p className="text-caption text-fg-muted">{ex.note}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <ExampleColumn title="Positive" items={e.positive ?? []} />
        <ExampleColumn title="Negative" items={e.negative ?? []} />
        <ExampleColumn title="Questions" items={e.questions ?? []} />
      </div>

      {e.signal_words?.length > 0 && (
        <Section title="Signal words">
          <ul className="flex flex-wrap gap-1.5">
            {e.signal_words.map((word) => (
              <li key={word}>
                <Badge variant="outline">{word}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {e.common_mistakes?.length > 0 && (
        <Section title="Common mistakes">
          <ul className="grid gap-2">
            {e.common_mistakes.map((m, i) => (
              <li key={i} className="grid gap-0.5 rounded-lg border-l-2 border-warning bg-background px-3 py-2">
                <p className="text-body-sm text-fg-muted line-through">{m.wrong}</p>
                <p className="text-body-sm font-medium">{m.right}</p>
                <p className="text-caption text-fg-secondary">{m.why}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {e.compare_note && (
        <Section title="Easy to confuse">
          <p className="text-body-sm text-fg-secondary">{e.compare_note}</p>
        </Section>
      )}

      {e.tips?.length > 0 && (
        <Section title="Tips">
          <ul className="grid gap-1.5">
            {e.tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-body-sm text-fg-secondary">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                {tip}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {e.mini_check && <MiniCheck check={e.mini_check} />}
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h4 className="text-label tracking-wide text-fg-muted uppercase">{title}</h4>
      {children}
    </section>
  );
}

function ExampleColumn({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-label text-fg-muted">{title}</h4>
      <ul className="grid gap-1">
        {items.map((item, i) => (
          <li key={i} className="text-body-sm">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One question at the end of an explanation. A check, not a quiz: practice is elsewhere. */
function MiniCheck({ check }: { check: NonNullable<GrammarExplanationResponse["explanation"]["mini_check"]> }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;

  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-4">
      <p className="text-body-sm font-medium">{check.question}</p>
      <div role="group" aria-label={check.question} className="grid gap-1.5">
        {check.options.map((option, i) => {
          const isAnswer = i === check.answer;
          const isPicked = i === picked;
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => setPicked(i)}
              className={[
                "rounded-lg border px-3 py-2 text-left text-body-sm transition-colors duration-micro outline-none",
                "focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default",
                answered && isAnswer ? "border-success bg-success/10" : "",
                answered && isPicked && !isAnswer ? "border-error bg-error/10" : "",
                !answered ? "hover:bg-surface-hover" : "",
              ].join(" ")}
            >
              {option}
            </button>
          );
        })}
      </div>
      {answered && (
        <p role="status" className="text-caption text-fg-secondary">
          {picked === check.answer ? "Correct." : `The correct answer is “${check.options[check.answer]}”.`}
        </p>
      )}
    </div>
  );
}

/**
 * The contextual tutor. It is scoped to this topic on the server, which is what keeps it a
 * tutor rather than a general chatbot sitting behind Engora's rate limits.
 */
export function TutorPanel({ slug, topicName }: { slug: string; topicName: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const ask = useGrammarTutor(slug);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [history, ask.isPending]);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageCircle aria-hidden />
        Ask AI about this topic
      </Button>
    );
  }

  const submit = () => {
    const text = question.trim();
    if (!text || ask.isPending) return;
    const sent = [...history, { role: "user" as const, content: text }];
    setHistory(sent);
    setQuestion("");
    ask.mutate(
      // The last 6 turns only: a thread about one grammar point does not need more, and an
      // unbounded history is an unbounded bill.
      { question: text, history: history.slice(-6) },
      { onSuccess: (reply) => setHistory([...sent, { role: "assistant", content: reply.answer }]) },
    );
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-surface p-5">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-h4">Ask about {topicName}</h3>
        <AIBadge />
      </header>

      {history.length === 0 && !ask.isPending && (
        <p className="text-body-sm text-fg-muted">
          Ask anything about this rule — for example, “Why can’t I say I didn’t went?”
        </p>
      )}

      {history.length > 0 && (
        <div className="grid max-h-80 gap-3 overflow-y-auto">
          {history.map((message, i) => (
            <div
              key={i}
              className={
                message.role === "user"
                  ? "justify-self-end rounded-xl rounded-br-sm bg-primary-subtle px-3 py-2 text-body-sm text-primary-subtle-foreground"
                  : "rounded-xl rounded-bl-sm bg-surface-active px-3 py-2 text-body-sm whitespace-pre-wrap"
              }
            >
              {message.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {ask.isPending && <InlineLoader label="Thinking…" />}
      {ask.isError && <AIFailure error={ask.error} what="The AI tutor" />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask about ${topicName}…`}
          aria-label={`Ask about ${topicName}`}
          maxLength={500}
        />
        <Button type="submit" disabled={!question.trim()} loading={ask.isPending}>
          <Send aria-hidden />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}

/**
 * Visual grammar. Canonical visuals are generated once for everyone, so this usually
 * returns a diagram that already exists — the button is a lookup far more often than it is
 * a generation.
 */
export function VisualPanel({ slug, existing }: { slug: string; existing: GrammarVisual[] }) {
  const [visual, setVisual] = useState<GrammarVisual | null>(existing[0] ?? null);
  const generate = useGrammarVisual(slug);

  if (!visual) {
    return (
      <div className="grid gap-2">
        <Button
          variant="outline"
          loading={generate.isPending}
          onClick={() => generate.mutate({}, { onSuccess: setVisual })}
        >
          <ImageIcon aria-hidden />
          Visualize this grammar
        </Button>
        {generate.isPending && <InlineLoader label="Drawing the diagram…" />}
        {generate.isError && <AIFailure error={generate.error} what="Visual generation" />}
      </div>
    );
  }

  return (
    <figure className="grid gap-2 rounded-xl border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-h4">Visual</h3>
        <AIBadge cached />
      </div>
      {/* The diagram is an SVG served by the API. It inherits the app's colours, so it
          reads correctly in both themes rather than being a picture of a light-mode page.
          next/image is deliberately not used: it would proxy and rasterize a vector that is
          already a few kilobytes, losing exactly the theming this relies on. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={apiAssetUrl(visual.url) ?? visual.url}
        alt={visual.alt_text}
        loading="lazy"
        className="w-full rounded-lg bg-background p-2"
      />
      {visual.caption && <figcaption className="text-caption text-fg-muted">{visual.caption}</figcaption>}
    </figure>
  );
}
