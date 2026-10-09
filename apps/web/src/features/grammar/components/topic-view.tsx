"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Clock,
  ChevronDown,
  Columns2,
  Languages,
  ListChecks,
  Mic,
  PenLine,
  Quote,
  Shuffle,
  Sigma,
  Sparkles,
  Target,
  Timer,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { ErrorState } from "@/components/common/states";
import { isApiError } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrammarRelatedTopic, GrammarTopic } from "@engora/types";

import { useGrammarComparison, useGrammarTopic } from "../hooks";
import { ExplainPanel, TutorPanel, VisualPanel } from "./ai-panels";
import { ExampleList, ExceptionList, FormulaList, LessonSection, MistakeList, RichText, SignalWords, UsageList } from "./lesson-blocks";
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
  // Undefined means "whatever my profile says", which is what almost every learner gets.
  // A value here is an explicit choice made on this page.
  const [language, setLanguage] = useState<string | undefined>();
  const topic = useGrammarTopic(slug, language);
  const compareParam = useSearchParams().get("compare");

  if (topic.isPending) return <TopicSkeleton />;
  // A topic on the map that is not published yet answers "not found". That is not a fault: it
  // is a lesson the teacher is still writing, and the learner is told so.
  if (topic.isError && isApiError(topic.error) && topic.error.status === 404) return <ComingSoonTopic />;
  if (topic.isError) return <ErrorState error={topic.error} onRetry={() => void topic.refetch()} />;
  if (!topic.data) return null;

  const t = topic.data;

  return (
    // One column, the full width of the learning area: the lesson is the page. Progress sits
    // under the title as a strip — read once on arrival, not pinned beside the text taking a
    // fifth of the width for the whole read — and where to go next comes at the end, which is
    // when the learner is looking for it.
    <div className="mx-auto w-full max-w-[84rem]">
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
            </p>
          </div>
        </header>

        <ProgressStrip topic={t} />

        {t.content ? (
          <div className="lesson-paper grid gap-8 rounded-2xl p-4 sm:p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <span className="text-caption text-fg-muted">One lesson for every level — practice below adapts to yours</span>
              <ContentLanguageSwitch
                current={t.content_language}
                available={t.content_languages ?? []}
                pending={topic.isFetching}
                onChange={setLanguage}
              />
            </div>
            <LessonJumpBar sections={lessonSections(t.content, t.content_language)} />
            <CanonicalContent topic={t} />
            {/* The same rule again, written for this learner's level — on request, so the page
                does not teach it twice in a row. */}
            <SimplerExplanation slug={t.slug} />
          </div>
        ) : (
          // No curated text for this topic yet, so the generated lesson is the lesson.
          <section aria-labelledby="ai-title" className="lesson-paper grid gap-3 rounded-2xl p-4 sm:p-6 lg:p-8">
            <h2 id="ai-title" className="text-h3">
              What is {t.name}?
            </h2>
            <ExplainPanel slug={t.slug} level={null} isPrimary />
          </section>
        )}

        {t.compare.length > 0 && <CompareSection topic={t} initial={compareParam} />}

        <section aria-labelledby="tools-title" className="grid gap-3">
          <h2 id="tools-title" className="text-h3">
            Go deeper
          </h2>
          <VisualPanel slug={t.slug} existing={t.visuals} />
          <TutorPanel slug={t.slug} topicName={t.name} />
        </section>

        <PracticeHub topic={t} />

        <WhereNext topic={t} />
      </article>
    </div>
  );
}

/**
 * The lesson's headings in the language the lesson is written in. An Uzbek explanation under
 * English headings reads as two half-translated pages; the headings follow the text.
 */
const lessonLabels = {
  en: {
    whatIs: (name: string) => `What is ${name}?`,
    rule: "Rule",
    form: "Form",
    whenToUse: "When to use",
    whenTitle: "When do we use it?",
    exceptions: "Exceptions",
    examples: "Examples",
    mistakes: "Mistakes",
    mistakesTitle: "Common mistakes",
    practise: "Practise",
    signalWords: "Signal words",
  },
  uz: {
    whatIs: (name: string) => `${name} nima?`,
    rule: "Qoida",
    form: "Tuzilishi",
    whenToUse: "Qachon ishlatiladi",
    whenTitle: "Qachon ishlatiladi?",
    exceptions: "Istisnolar",
    examples: "Misollar",
    mistakes: "Xatolar",
    mistakesTitle: "Ko'p uchraydigan xatolar",
    practise: "Mashq",
    signalWords: "Kalit so'zlar",
  },
  ru: {
    whatIs: (name: string) => `Что такое ${name}?`,
    rule: "Правило",
    form: "Образование",
    whenToUse: "Когда используется",
    whenTitle: "Когда это используется?",
    exceptions: "Исключения",
    examples: "Примеры",
    mistakes: "Ошибки",
    mistakesTitle: "Типичные ошибки",
    practise: "Практика",
    signalWords: "Слова-маркеры",
  },
};

function labelsFor(language: string | undefined) {
  return lessonLabels[language as keyof typeof lessonLabels] ?? lessonLabels.en;
}

/** The sections of the lesson, in reading order, for the jump bar above it. */
function lessonSections(c: NonNullable<GrammarTopic["content"]>, language?: string) {
  const l = labelsFor(language);
  return [
    { id: "rule", label: l.rule, show: true },
    { id: "form", label: l.form, show: c.formulas.length > 0 },
    { id: "usage", label: l.whenToUse, show: c.usage.length > 0 },
    { id: "exceptions", label: l.exceptions, show: (c.exceptions?.length ?? 0) > 0 },
    { id: "examples", label: l.examples, show: c.examples.length > 0 },
    { id: "mistakes", label: l.mistakes, show: c.common_mistakes.length > 0 },
    { id: "practice-title", label: l.practise, show: true },
  ].filter((s) => s.show);
}

/** A row of chips that jumps to each part of the lesson; it stays in reach while reading. */
function LessonJumpBar({ sections }: { sections: { id: string; label: string }[] }) {
  return (
    <nav
      aria-label="Lesson sections"
      className="sticky top-[calc(var(--app-header-h,3rem)+0.75rem)] z-[5] -mx-1 flex gap-1.5 overflow-x-auto rounded-xl border bg-surface-elevated/95 p-1.5 shadow-sm backdrop-blur"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="shrink-0 rounded-lg px-3 py-1.5 text-body-sm font-medium text-fg-secondary outline-none transition-colors duration-micro hover:bg-surface-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

function CanonicalContent({ topic }: { topic: GrammarTopic }) {
  const c = topic.content!;
  const l = labelsFor(topic.content_language);
  return (
    <div className="grid gap-10">
      <LessonSection id="rule" title={l.whatIs(topic.name)} tone="rule" icon={BookOpenText}>
        <div data-tone="rule" className="lesson-block grid gap-3 rounded-xl px-5 py-4">
          {c.intro && <RichText text={c.intro} className="text-body-lg font-medium" />}
          {c.explanation
            .split("\n\n")
            .filter(Boolean)
            .map((paragraph, i) => (
              <p key={i} className="text-body leading-relaxed text-fg-secondary">
                <RichText text={paragraph} />
              </p>
            ))}
        </div>
        {c.signal_words.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label text-fg-muted">{l.signalWords}</span>
            <SignalWords words={c.signal_words} />
          </div>
        )}
      </LessonSection>

      {c.formulas.length > 0 && (
        <LessonSection id="form" title={l.form} tone="formula" icon={Sigma} count={c.formulas.length}>
          <FormulaList formulas={c.formulas} />
        </LessonSection>
      )}

      {c.usage.length > 0 && (
        <LessonSection id="usage" title={l.whenTitle} tone="usage" icon={Target}>
          <UsageList items={c.usage.map((use) => ({ use }))} />
        </LessonSection>
      )}

      {c.exceptions && c.exceptions.length > 0 && (
        <LessonSection id="exceptions" title={l.exceptions} tone="exception" icon={Shuffle} count={c.exceptions.length}>
          <ExceptionList items={c.exceptions} />
        </LessonSection>
      )}

      {c.examples.length > 0 && (
        <LessonSection id="examples" title={l.examples} tone="example" icon={Quote} count={c.examples.length}>
          <ExampleList items={c.examples} />
        </LessonSection>
      )}

      {c.common_mistakes.length > 0 && (
        <LessonSection id="mistakes" title={l.mistakesTitle} tone="mistake" icon={TriangleAlert} count={c.common_mistakes.length}>
          <MistakeList items={c.common_mistakes} />
        </LessonSection>
      )}
    </div>
  );
}

/**
 * The AI's second pass over the rule, written for the learner's level. Closed until asked for:
 * open by default it repeated the whole lesson straight underneath itself.
 */
function SimplerExplanation({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="simpler-title" className="grid gap-3 border-t pt-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <span className="grid min-w-0 flex-1">
          <span id="simpler-title" className="text-body font-medium">
            Explain it for my level
          </span>
          <span className="text-caption text-fg-muted">The same rule in simpler words, with more examples — written by AI</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform duration-micro", open && "rotate-180")} aria-hidden />
      </button>
      {open && <ExplainPanel slug={slug} level={null} />}
    </section>
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

/**
 * Every way to practise this topic, in one place.
 *
 * Questions, a test, speaking and writing are the same decision — "now use it" — so they sit
 * together as four equal tiles rather than a practice card and a separate "real English"
 * section further down. Questions lead: they are the quickest way to find a weak rule. A
 * topic with no questions yet still offers speaking and writing, which never run out.
 */
function PracticeHub({ topic: t }: { topic: GrammarTopic }) {
  const slug = encodeURIComponent(t.slug);
  const name = t.name.toLowerCase();
  const tiles: PracticeTileProps[] = [
    {
      icon: ListChecks,
      title: "Practice",
      body: t.has_practice
        ? `${t.question_count} questions, marked as you go. Your weak rules come first.`
        : "Questions for this topic are on their way.",
      href: `/app/grammar/${t.slug}/practice`,
      disabled: !t.has_practice,
      primary: true,
    },
    {
      icon: Timer,
      title: "Test mode",
      body: t.has_practice ? "No hints, a score at the end. See where you really are." : "Available once there are questions.",
      href: `/app/grammar/${t.slug}/practice?mode=test`,
      disabled: !t.has_practice,
    },
    {
      icon: Mic,
      title: "Speaking",
      body: `Say it out loud: talk about something that needs ${name}.`,
      href: `/app/speaking?topic=${slug}`,
    },
    {
      icon: PenLine,
      title: "Writing",
      body: `A short task built around ${name}, checked with it in mind.`,
      href: `/app/writing?topic=${slug}`,
    },
  ];

  return (
    <section aria-labelledby="practice-title" className="grid gap-4 rounded-2xl border bg-surface p-4 sm:p-5">
      <header className="grid gap-1">
        <h2 id="practice-title" className="text-h3">
          Practise {t.name}
        </h2>
        <p className="text-body-sm text-fg-secondary">
          Grammar becomes yours when you use it. Pick how — every option here is about this topic.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.title} className="grid">
            <PracticeTile {...tile} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface PracticeTileProps {
  icon: typeof Mic;
  title: string;
  body: string;
  href: string;
  disabled?: boolean;
  primary?: boolean;
}

function PracticeTile({ icon: Icon, title, body, href, disabled = false, primary = false }: PracticeTileProps) {
  const inner = (
    <>
      <span
        className={cn(
          "grid size-9 place-items-center rounded-lg",
          primary && !disabled ? "bg-primary text-primary-foreground" : "bg-primary-subtle text-primary",
          disabled && "bg-surface-active text-fg-muted",
        )}
      >
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="grid gap-1">
        <span className="flex items-center gap-1.5 text-body font-medium">
          {title}
          {!disabled && (
            <ArrowRight
              className="size-4 text-fg-muted transition-transform duration-micro group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden
            />
          )}
        </span>
        <span className="text-caption text-fg-muted">{body}</span>
      </span>
    </>
  );
  const base = "group flex h-full flex-col gap-3 rounded-xl border p-4 outline-none transition-colors duration-micro";
  if (disabled) {
    return (
      <div aria-disabled className={cn(base, "border-dashed opacity-70")}>
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        base,
        "focus-visible:ring-[3px] focus-visible:ring-ring/40",
        primary
          ? "border-primary/40 bg-primary-subtle/50 hover:bg-primary-subtle"
          : "bg-surface hover:border-primary/30 hover:bg-surface-hover",
      )}
    >
      {inner}
    </Link>
  );
}

/**
 * The learner's standing on this topic, as one strip under the title.
 *
 * Overall mastery on the left, the three things it is made of beside it. Wide screens get
 * them in one row; narrow ones stack them. It is not sticky: it is context for arriving at the
 * page, and the lesson below it is what the page is for.
 */
function ProgressStrip({ topic }: { topic: GrammarTopic }) {
  const p = topic.progress;
  const parts = [
    ["Understanding", p.understanding],
    ["Practice", p.practice],
    ["Application", p.application],
  ] as const;
  return (
    <section
      aria-labelledby="your-progress-title"
      className="grid gap-4 rounded-xl border bg-surface p-4 sm:p-5 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] md:items-center md:gap-8"
    >
      <div className="grid gap-2">
        <h2 id="your-progress-title" className="text-label text-fg-muted">
          Your progress
        </h2>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-h2 tabular-nums">{Math.round(p.mastery)}%</span>
          <StateBadge state={p.state} mastery={p.mastery} />
        </div>
        <MasteryBar value={p.mastery} />
        {p.attempts > 0 && (
          <p className="text-caption text-fg-muted">
            {p.attempts} practice {p.attempts === 1 ? "run" : "runs"}
          </p>
        )}
      </div>
      <dl className="grid gap-3 sm:grid-cols-3 sm:gap-6">
        {parts.map(([label, value]) => (
          <div key={label}>
            <Meter
              label={label}
              value={value}
              display={`${Math.round(value)}%`}
              tone={value >= 80 ? "success" : value < 50 ? "warning" : "primary"}
            />
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Prerequisites, related topics and what comes next — at the end, where the learner looks for them. */
function WhereNext({ topic }: { topic: GrammarTopic }) {
  const groups = [
    ["Before this", topic.prerequisites],
    ["Related", topic.related],
    ["Next", topic.next],
  ] as const;
  if (groups.every(([, topics]) => !topics?.length)) return null;
  return (
    <section aria-labelledby="where-next-title" className="grid gap-3">
      <h2 id="where-next-title" className="text-h3">
        Where to go next
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(([title, topics]) =>
          topics?.length ? (
            <div key={title} className="rounded-xl border bg-surface p-3">
              <RailList title={title} topics={topics} />
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}

function RailList({ title, topics }: { title: string; topics: GrammarRelatedTopic[] }) {
  // The API guarantees an array, but one unexpected null should hide a sidebar section,
  // not take the whole topic page down with it.
  if (!topics?.length) return null;
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

/** A topic that exists in the curriculum but has not been published yet. */
function ComingSoonTopic() {
  return (
    <div className="mx-auto grid w-full max-w-2xl justify-items-center gap-4 rounded-2xl border bg-surface px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-warning/15 text-warning-text">
        <Clock className="size-7" aria-hidden />
      </span>
      <div className="grid gap-1.5">
        <h1 className="text-h3">This topic is being prepared</h1>
        <p className="text-body text-fg-secondary">
          Your teacher is still writing this lesson. It will open here as soon as it is ready — in the meantime, pick
          another topic from the map.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/app/grammar/map">Back to the grammar map</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/grammar">All grammar</Link>
        </Button>
      </div>
    </div>
  );
}

function TopicSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-[84rem] gap-6">
      <Skeleton className="h-10 w-2/3 rounded-lg" />
      <Skeleton className="h-4 w-1/3 rounded" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

const languageNames: Record<string, string> = { uz: "O'zbekcha", en: "English", ru: "Русский" };
/** The order the switch lists them in: the platform's default first. */
const languageOrder = ["uz", "en", "ru"] as const;

/**
 * Which language the explanation is read in.
 *
 * Uzbek by default; the switch offers only the languages this topic is actually written in,
 * so every choice shows the owner's text for that language — never a machine translation
 * made on the spot, and never an option that quietly falls back to another. It changes the
 * explanation and nothing else: the examples are English in every language anyway.
 */
function ContentLanguageSwitch({
  current,
  available,
  pending,
  onChange,
}: {
  current?: string;
  available: string[];
  pending: boolean;
  onChange: (lang: string) => void;
}) {
  const options = languageOrder.filter((code) => available.includes(code));
  if (options.length <= 1) {
    return options.length === 1 && current ? (
      <span className="flex items-center gap-1.5 text-caption text-fg-muted">
        <Languages className="size-3.5" aria-hidden />
        Only in {languageNames[current] ?? current} for now
      </span>
    ) : null;
  }
  return (
    <div
      role="radiogroup"
      aria-label="Explanation language"
      aria-busy={pending}
      className="inline-flex items-center gap-0.5 rounded-lg border bg-surface p-0.5"
    >
      <Languages className="mx-1.5 size-3.5 text-fg-muted" aria-hidden />
      {options.map((code) => {
        const selected = code === current;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => !selected && onChange(code)}
            className={cn(
              "rounded-md px-2.5 py-1 text-caption font-medium transition-colors duration-micro outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              selected ? "bg-primary-subtle text-primary-subtle-foreground" : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {languageNames[code]}
          </button>
        );
      })}
    </div>
  );
}
