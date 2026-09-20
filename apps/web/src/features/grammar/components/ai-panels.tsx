"use client";

import { CircleAlert, Image as ImageIcon, MessageCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { InlineLoader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/errors";
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

function AIFailure({ error, what }: { error: unknown; what: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-dashed px-4 py-3">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="text-body-sm text-fg-secondary">
        {errorMessage(error) || `${what} is temporarily unavailable.`}
      </p>
    </div>
  );
}

export function ExplainPanel({ slug, level }: { slug: string; level: string | null }) {
  const explain = useGrammarExplanation(slug);
  const data = explain.data as GrammarExplanationResponse | undefined;

  if (!data && !explain.isPending && !explain.isError) {
    return (
      <Button variant="outline" onClick={() => explain.mutate()}>
        <Sparkles aria-hidden />
        Explain with AI
      </Button>
    );
  }

  return (
    <div className="grid gap-4">
      {explain.isPending && (
        <div className="grid gap-3 rounded-xl border bg-surface p-5">
          <InlineLoader label={`Explaining this at your level${level ? ` (${level})` : ""}…`} />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {explain.isError && <AIFailure error={explain.error} what="AI explanation" />}

      {data && (
        <article className="grid gap-5 rounded-xl border bg-surface p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-h4">Explained for you</h3>
            <span className="flex items-center gap-2">
              {data.level && <Badge variant="outline">{data.level}</Badge>}
              <AIBadge cached={data.cached} />
            </span>
          </header>

          <p className="text-body">{data.explanation.definition}</p>

          {data.explanation.when_to_use.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-label text-fg-muted">When to use it</h4>
              <ul className="grid gap-1">
                {data.explanation.when_to_use.map((item, i) => (
                  <li key={i} className="text-body-sm text-fg-secondary">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.explanation.formulas.length > 0 && (
            <div className="grid gap-2">
              <h4 className="text-label text-fg-muted">Form</h4>
              {data.explanation.formulas.map((f, i) => (
                <div key={i} className="rounded-lg bg-surface-active px-3 py-2">
                  <p className="text-label">{f.label}</p>
                  <p className="font-mono text-body-sm">{f.pattern}</p>
                  {f.example && <p className="mt-1 text-body-sm text-fg-secondary">{f.example}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <ExampleColumn title="Positive" items={data.explanation.positive} />
            <ExampleColumn title="Negative" items={data.explanation.negative} />
            <ExampleColumn title="Questions" items={data.explanation.questions} />
          </div>

          {data.explanation.common_mistakes.length > 0 && (
            <div className="grid gap-2">
              <h4 className="text-label text-fg-muted">Watch out for</h4>
              {data.explanation.common_mistakes.map((m, i) => (
                <div key={i} className="grid gap-0.5 rounded-lg border-l-2 border-warning bg-surface-active px-3 py-2">
                  <p className="text-body-sm text-fg-muted line-through">{m.wrong}</p>
                  <p className="text-body-sm font-medium">{m.right}</p>
                  <p className="text-caption text-fg-secondary">{m.why}</p>
                </div>
              ))}
            </div>
          )}

          {data.explanation.mini_check && <MiniCheck check={data.explanation.mini_check} />}
        </article>
      )}
    </div>
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
