"use client";

import { ArrowLeft, ArrowRight, Columns2, Mic, PenLine, Sparkles } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrammarRelatedTopic, GrammarTopic } from "@engora/types";

import { useGrammarComparison, useGrammarTopic } from "../hooks";
import { ExplainPanel, TutorPanel, VisualPanel } from "./ai-panels";
import { MasteryBar, StateBadge } from "./shared";

/**
 * One grammar topic.
 *
 * The canonical rule leads and is never hidden behind an interaction: a learner who opens
 * Past Simple should be reading Past Simple, not choosing between tabs. The AI tools and
 * the practice call sit underneath it, and on a wide screen the learner's own standing on
 * the topic moves into a right rail where it can be glanced at without interrupting the text.
 */
export function GrammarTopicView({ slug }: { slug: string }) {
  const topic = useGrammarTopic(slug);
  const compareParam = useSearchParams().get("compare");

  if (topic.isPending) return <TopicSkeleton />;
  if (topic.isError) return <ErrorState error={topic.error} onRetry={() => void topic.refetch()} />;
  if (!topic.data) return null;

  const t = topic.data;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-10">
      <article className="grid min-w-0 gap-8">
        <header className="grid gap-3">
          <Link
            href="/app/grammar"
            className="inline-flex w-fit items-center gap-1.5 text-label text-fg-muted transition-colors duration-micro hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Grammar
          </Link>
          <div className="grid gap-2">
            <h1 className="text-h1">{t.name}</h1>
            <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
              {t.level && <Badge variant="outline">{t.level}</Badge>}
              <Link href={`/app/grammar?category=${t.category}`} className="hover:text-foreground">
                {t.category_name}
              </Link>
              <span aria-hidden>·</span>
              <span>{t.estimated_minutes} min</span>
              {t.ielts_relevant && <Badge variant="secondary">IELTS</Badge>}
              <StateBadge state={t.state} mastery={t.mastery} />
            </p>
          </div>
        </header>

        {t.content ? <CanonicalContent topic={t} /> : <ContentPending />}

        {t.compare.length > 0 && <CompareSection topic={t} initial={compareParam} />}

        <section aria-labelledby="ai-title" className="grid gap-3">
          <h2 id="ai-title" className="text-h3">
            Go deeper
          </h2>
          <p className="text-body-sm text-fg-muted">
            Generated for your level from the rule above — help around it, not a replacement for it.
          </p>
          <div className="flex flex-wrap gap-2">
            <ExplainPanel slug={t.slug} level={t.level} />
          </div>
          <VisualPanel slug={t.slug} existing={t.visuals} />
          <TutorPanel slug={t.slug} topicName={t.name} />
        </section>

        <section aria-labelledby="practice-title" className="grid gap-3 rounded-xl border bg-surface p-5">
          <h2 id="practice-title" className="text-h3">
            Practice
          </h2>
          {t.has_practice ? (
            <>
              <p className="text-body-sm text-fg-secondary">
                {t.question_count} questions. Answers are marked instantly and your weak points are tracked.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/app/grammar/${t.slug}/practice`}>
                    Practise this topic <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/app/grammar/${t.slug}/practice?mode=test`}>Test mode</Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-body-sm text-fg-muted">Practice for this topic is coming soon.</p>
          )}
        </section>

        {/* Grammar only becomes yours when you use it, so the page ends by sending the
            learner somewhere they have to produce it themselves. */}
        <section aria-labelledby="apply-title" className="grid gap-3">
          <h2 id="apply-title" className="text-h3">
            Use it in real English
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <ApplyCard
              icon={Mic}
              href="/app/speaking"
              title="Speaking"
              body={`Talk about something that needs ${t.name.toLowerCase()}.`}
            />
            <ApplyCard
              icon={PenLine}
              href="/app/writing"
              title="Writing"
              body={`Write a few sentences using ${t.name.toLowerCase()}.`}
            />
          </div>
        </section>
      </article>

      <TopicRail topic={t} />
    </div>
  );
}

function CanonicalContent({ topic }: { topic: GrammarTopic }) {
  const c = topic.content!;
  return (
    <div className="grid gap-8">
      <section aria-labelledby="what-title" className="grid gap-3">
        <h2 id="what-title" className="text-h3">
          What is {topic.name}?
        </h2>
        {c.intro && <p className="text-body-lg text-fg-secondary">{c.intro}</p>}
        {c.explanation.split("\n\n").map((paragraph, i) => (
          <p key={i} className="text-body">
            {paragraph}
          </p>
        ))}
      </section>

      {c.formulas.length > 0 && (
        <section aria-labelledby="form-title" className="grid gap-3">
          <h2 id="form-title" className="text-h3">
            Form
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {c.formulas.map((f) => (
              <div key={f.label} className="grid gap-1.5 rounded-xl border bg-surface p-4">
                <p className="text-label text-fg-muted">{f.label}</p>
                <p className="font-mono text-body-sm">{f.pattern}</p>
                {f.examples.length > 0 && (
                  <ul className="grid gap-0.5 border-t pt-2">
                    {f.examples.map((e, i) => (
                      <li key={i} className="text-body-sm text-fg-secondary">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {c.usage.length > 0 && (
        <section aria-labelledby="usage-title" className="grid gap-3">
          <h2 id="usage-title" className="text-h3">
            When do we use it?
          </h2>
          <ul className="grid gap-2">
            {c.usage.map((u, i) => (
              <li key={i} className="flex items-start gap-2 text-body">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {u}
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.signal_words.length > 0 && (
        <section aria-labelledby="signals-title" className="grid gap-3">
          <h2 id="signals-title" className="text-h3">
            Signal words
          </h2>
          <ul className="flex flex-wrap gap-2">
            {c.signal_words.map((word) => (
              <li key={word}>
                <Badge variant="outline" className="px-2.5 py-1 text-body-sm">
                  {word}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.examples.length > 0 && (
        <section aria-labelledby="examples-title" className="grid gap-3">
          <h2 id="examples-title" className="text-h3">
            Examples
          </h2>
          <ul className="divide-y rounded-xl border bg-surface">
            {c.examples.map((e, i) => (
              <li key={i} className="grid gap-0.5 px-4 py-3">
                <p className="text-body">{e.text}</p>
                {e.note && <p className="text-caption text-fg-muted">{e.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.common_mistakes.length > 0 && (
        <section aria-labelledby="mistakes-title" className="grid gap-3">
          <h2 id="mistakes-title" className="text-h3">
            Common mistakes
          </h2>
          <ul className="grid gap-3">
            {c.common_mistakes.map((m, i) => (
              <li key={i} className="grid gap-1.5 rounded-xl border-l-2 border-warning bg-surface px-4 py-3">
                <p className="text-body text-fg-muted line-through decoration-error/60">{m.wrong}</p>
                <p className="text-body font-medium">{m.right}</p>
                <p className="text-body-sm text-fg-secondary">{m.why}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * A topic whose canonical explanation has not been written yet. It says so plainly rather
 * than generating one: an invented rule that reads like the product's own is worse for a
 * learner than an honest gap.
 */
function ContentPending() {
  return (
    <EmptyState
      icon={Sparkles}
      title="The full explanation is being written"
      description="This topic is in the curriculum but its explanation has not been published yet. Its related topics and comparisons below still work."
    />
  );
}

function CompareSection({ topic, initial }: { topic: GrammarTopic; initial: string | null }) {
  const [other, setOther] = useState(
    () => topic.compare.find((c) => c.slug === initial)?.slug ?? topic.compare[0]!.slug,
  );
  const comparison = useGrammarComparison(topic.slug, other);

  return (
    <section aria-labelledby="compare-title" className="grid gap-3">
      <h2 id="compare-title" className="flex items-center gap-2 text-h3">
        <Columns2 className="size-5 text-fg-muted" aria-hidden />
        Compare
      </h2>

      {topic.compare.length > 1 && (
        <div role="group" aria-label="Choose a comparison" className="flex flex-wrap gap-2">
          {topic.compare.map((c) => (
            <button
              key={c.slug}
              type="button"
              aria-pressed={other === c.slug}
              onClick={() => setOther(c.slug)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-label transition-colors duration-micro outline-none",
                "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                other === c.slug
                  ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
                  : "bg-surface text-fg-secondary hover:bg-surface-hover hover:text-foreground",
              )}
            >
              vs {c.name}
            </button>
          ))}
        </div>
      )}

      {comparison.isPending ? (
        <Skeleton className="h-56 rounded-xl" />
      ) : comparison.isError || !comparison.data ? (
        <div className="rounded-xl border border-dashed p-5">
          <p className="text-body-sm text-fg-muted">
            A side-by-side comparison for this pair has not been written yet.{" "}
            <Link href={`/app/grammar/${other}`} className="text-primary hover:underline">
              Open {topic.compare.find((c) => c.slug === other)?.name ?? other}
            </Link>{" "}
            instead.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-body text-fg-secondary">{comparison.data.summary}</p>
          <div className="overflow-x-auto rounded-xl border bg-surface">
            <table className="w-full min-w-[32rem] border-collapse text-body-sm">
              <caption className="sr-only">
                {comparison.data.left.name} compared with {comparison.data.right.name}
              </caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="w-32 px-4 py-2.5 text-left text-label text-fg-muted">
                    &nbsp;
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-left text-label">
                    {comparison.data.left.name}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-left text-label">
                    {comparison.data.right.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.data.rows.map((row) => (
                  <tr key={row.aspect} className="border-b last:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left align-top font-medium text-fg-muted">
                      {row.aspect}
                    </th>
                    <td className="px-4 py-2.5 align-top">{row.left}</td>
                    <td className="px-4 py-2.5 align-top">{row.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/app/grammar/${topic.slug}/practice`}>Practise {topic.name}</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/app/grammar/${other}/practice`}>
                Practise {topic.compare.find((c) => c.slug === other)?.name ?? other}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function ApplyCard({
  icon: Icon,
  href,
  title,
  body,
}: {
  icon: typeof Mic;
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group grid gap-1 rounded-xl border bg-surface p-4 outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <span className="flex items-center gap-2 text-body-sm font-medium">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
      </span>
      <span className="text-caption text-fg-muted">{body}</span>
    </Link>
  );
}

/** On a narrow screen this becomes an ordinary section under the article. */
function TopicRail({ topic }: { topic: GrammarTopic }) {
  const p = topic.progress;
  return (
    <aside className="grid gap-6 lg:sticky lg:top-[calc(var(--app-header-h,3.5rem)+var(--main-pt,1.5rem))]">
      <section aria-labelledby="your-progress-title" className="grid gap-3 rounded-xl border bg-surface p-4">
        <h2 id="your-progress-title" className="text-label text-fg-muted">
          Your progress
        </h2>
        <div className="flex items-baseline gap-2">
          <span className="text-h2 tabular-nums">{Math.round(p.mastery)}%</span>
          <StateBadge state={p.state} mastery={p.mastery} />
        </div>
        <MasteryBar value={p.mastery} />
        <dl className="grid gap-2 pt-1">
          {(
            [
              ["Understanding", p.understanding],
              ["Practice", p.practice],
              ["Application", p.application],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <Meter label={label} value={value} display={`${Math.round(value)}%`} tone={value >= 80 ? "success" : value < 50 ? "warning" : "primary"} />
            </div>
          ))}
        </dl>
        {p.attempts > 0 && (
          <p className="text-caption text-fg-muted">
            {p.attempts} practice {p.attempts === 1 ? "run" : "runs"}
          </p>
        )}
      </section>

      <RailList title="Prerequisites" topics={topic.prerequisites} />
      <RailList title="Related" topics={topic.related} />
      <RailList title="Next" topics={topic.next} />
    </aside>
  );
}

function RailList({ title, topics }: { title: string; topics: GrammarRelatedTopic[] }) {
  if (topics.length === 0) return null;
  return (
    <section aria-label={title} className="grid gap-1.5">
      <h2 className="text-label text-fg-muted">{title}</h2>
      <ul className="grid gap-0.5">
        {topics.map((t) => (
          <li key={`${t.kind}-${t.slug}`}>
            <Link
              href={`/app/grammar/${t.slug}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-body-sm outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  t.state === "mastered" ? "bg-success" : t.mastery > 0 ? "bg-primary" : "bg-border",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.level && <span className="shrink-0 text-caption text-fg-muted">{t.level}</span>}
            </Link>
            {t.note && <p className="px-2 pb-1 text-caption text-fg-muted">{t.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopicSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-10">
      <div className="grid gap-6">
        <Skeleton className="h-10 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-1/3 rounded" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
