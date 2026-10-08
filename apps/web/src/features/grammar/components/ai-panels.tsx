"use client";

import {
  CircleAlert,
  Image as ImageIcon,
  Lightbulb,
  Lock,
  MessageCircle,
  Quote,
  Send,
  Shuffle,
  Sigma,
  Sparkles,
  Target,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { InlineLoader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, isApiError, type ApiError } from "@/lib/api/errors";
import { apiAssetUrl } from "@/lib/media";
import type { GrammarExplanationResponse, GrammarVisual } from "@engora/types";

import { useGrammarExplanation, useGrammarTutor, useGrammarVisual } from "../hooks";
import {
  ExampleColumns,
  ExampleList,
  FormulaList,
  LessonSection,
  MistakeList,
  RichText,
  SignalWords,
  SimpleMarkdown,
  TipList,
  UsageList,
} from "./lesson-blocks";
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
    <article className="grid gap-6 rounded-xl border bg-surface p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <h3 className="text-h3">{isPrimary ? "The rule" : "Explained for you"}</h3>
        <span className="flex items-center gap-2">
          {data.level && <Badge variant="outline">{data.level}</Badge>}
          <AIBadge cached={data.cached} />
        </span>
      </header>

      {(e.summary || e.paragraphs?.length > 0) && (
        <div data-tone="rule" className="lesson-block grid gap-3 rounded-xl px-5 py-4">
          {e.summary && <RichText text={e.summary} className="text-body-lg font-medium" />}
          {e.paragraphs?.map((paragraph, i) => (
            <p key={i} className="text-body leading-relaxed text-fg-secondary">
              <RichText text={paragraph} />
            </p>
          ))}
        </div>
      )}

      {e.formulas?.length > 0 && (
        <LessonSection id={`${slug}-ai-form`} title="Form" tone="formula" icon={Sigma} count={e.formulas.length}>
          <FormulaList formulas={e.formulas} />
        </LessonSection>
      )}

      {e.when_to_use?.length > 0 && (
        <LessonSection id={`${slug}-ai-usage`} title="When to use it" tone="usage" icon={Target}>
          <UsageList items={e.when_to_use} />
        </LessonSection>
      )}

      {(e.examples?.length > 0 || e.positive?.length || e.negative?.length || e.questions?.length) && (
        <LessonSection id={`${slug}-ai-examples`} title="Examples" tone="example" icon={Quote}>
          {e.examples?.length > 0 && <ExampleList items={e.examples.map((ex) => ({ text: ex.sentence, note: ex.note }))} />}
          <ExampleColumns positive={e.positive ?? []} negative={e.negative ?? []} questions={e.questions ?? []} />
        </LessonSection>
      )}

      {e.signal_words?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label text-fg-muted">Signal words</span>
          <SignalWords words={e.signal_words} />
        </div>
      )}

      {e.common_mistakes?.length > 0 && (
        <LessonSection id={`${slug}-ai-mistakes`} title="Common mistakes" tone="mistake" icon={TriangleAlert} count={e.common_mistakes.length}>
          <MistakeList items={e.common_mistakes} />
        </LessonSection>
      )}

      {e.compare_note && (
        <LessonSection id={`${slug}-ai-confuse`} title="Easy to confuse" tone="exception" icon={Shuffle}>
          <p data-tone="exception" className="lesson-block rounded-xl px-4 py-3 text-body">
            <RichText text={e.compare_note} />
          </p>
        </LessonSection>
      )}

      {e.tips?.length > 0 && (
        <LessonSection id={`${slug}-ai-tips`} title="Tips" tone="tip" icon={Lightbulb}>
          <TipList items={e.tips} />
        </LessonSection>
      )}

      {e.mini_check && <MiniCheck check={e.mini_check} />}
    </article>
  );
}

/** One question at the end of an explanation. A check, not a quiz: practice is elsewhere. */
function MiniCheck({ check }: { check: NonNullable<GrammarExplanationResponse["explanation"]["mini_check"]> }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;

  return (
    <div className="grid gap-2 rounded-xl border border-dashed p-4">
      <p className="text-label text-fg-muted">Quick check</p>
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
                  : "rounded-xl rounded-bl-sm bg-surface-active px-4 py-3 text-body-sm leading-relaxed"
              }
            >
              {message.role === "assistant" ? <SimpleMarkdown text={message.content} /> : message.content}
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
      {/* The diagram is an SVG served by the API on a light card of its own (see ai.ThemeSVG),
          so it reads the same in both themes. next/image is deliberately not used: it would
          proxy and rasterize a vector that is already a few kilobytes. Capped and centred: on
          a full-width lesson a diagram stretched edge to edge is bigger than anyone reads. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={apiAssetUrl(visual.url) ?? visual.url}
        alt={visual.alt_text}
        loading="lazy"
        className="mx-auto w-full max-w-4xl rounded-lg"
      />
      {visual.caption && <figcaption className="text-caption text-fg-muted">{visual.caption}</figcaption>}
    </figure>
  );
}
