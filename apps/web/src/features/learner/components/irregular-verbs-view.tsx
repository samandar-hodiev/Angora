"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCheck,
  ChevronRight,
  Dumbbell,
  Eye,
  EyeOff,
  Info,
  ListChecks,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Table2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { FlagRU, FlagUZ } from "@/components/common/flags";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/data-display";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { IrregularVerb, IrregularVerbQuery, VerbCheck, VerbPattern, VerbState } from "@engora/types";

import { learnerApi } from "../api";
import { useAnswerVerb, useIrregularVerbs } from "../hooks";
import { LEVEL_NAMES, LEVELS, LevelTag, Segmented, SpeakButton } from "./vocabulary/shared";

/** The four ways the forms change — the groups the table is learned in. */
const PATTERNS: Record<VerbPattern, { title: string; example: string; uz: string }> = {
  ABC: { title: "All three different", example: "go – went – gone", uz: "Uchala shakl har xil — eng ko'p yodlanadiganlari." },
  ABB: { title: "Past = participle", example: "buy – bought – bought", uz: "Ikkinchi va uchinchi shakl bir xil." },
  ABA: { title: "Base = participle", example: "come – came – come", uz: "Birinchi va uchinchi shakl bir xil." },
  AAA: { title: "All three the same", example: "cut – cut – cut", uz: "Uchala shakl bir xil — faqat gapdan bilinadi." },
};
const PATTERN_ORDER: VerbPattern[] = ["ABC", "ABB", "ABA", "AAA"];

const STATE_DOT: Record<VerbState, { label: string; className: string }> = {
  never: { label: "Not practised", className: "bg-border" },
  learning: { label: "Learning", className: "bg-primary" },
  mistake: { label: "Last answer was wrong", className: "bg-error" },
  known: { label: "Known — three right in a row", className: "bg-success" },
};

type Tab = "table" | "practice";
type Hide = "" | "forms" | "translations";

/**
 * Irregular verbs: the table, grouped by how the forms change, and practice that asks for the
 * two forms a learner does not see. Every answer is kept, so mistakes come back first.
 */
export function IrregularVerbsView() {
  const [tab, setTab] = useState<Tab>("table");
  const [practiceMistakes, setPracticeMistakes] = useState(0);

  return (
    <>
      <PageHeader
        pinned={false}
        compact
        title="Irregular verbs"
        description="The verbs whose past forms you have to know by heart — grouped so they are easier to learn, and practised until they stick."
      />
      <div role="tablist" aria-label="Irregular verbs" className="mb-5 inline-flex gap-1 rounded-xl border bg-surface p-1">
        {(
          [
            ["table", "Table", Table2],
            ["practice", "Practice", Dumbbell],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-1.5 text-label outline-none transition-colors duration-micro",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              tab === value ? "bg-primary-subtle text-primary-subtle-foreground" : "text-fg-secondary hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {tab === "table" ? (
        <VerbTable
          onPracticeMistakes={() => {
            setPracticeMistakes((n) => n + 1);
            setTab("practice");
          }}
        />
      ) : (
        <Practice key={practiceMistakes} startWithMistakes={practiceMistakes > 0} />
      )}
    </>
  );
}

// ---- Table ----------------------------------------------------------------------------------

function VerbTable({ onPracticeMistakes }: { onPracticeMistakes: () => void }) {
  const [query, setQuery] = useState<IrregularVerbQuery>({ q: "", level: "", pattern: "", show: "" });
  const [hide, setHide] = useState<Hide>("");
  const [grouped, setGrouped] = useState(true);
  const table = useIrregularVerbs({ ...query, q: query.q.trim() });
  const data = table.data;
  const set = (patch: Partial<IrregularVerbQuery>) => setQuery((q) => ({ ...q, ...patch }));
  const count = (code: string) => data?.levels.find((l) => l.value === code)?.count ?? 0;

  const groups = useMemo(() => {
    const items = data?.items ?? [];
    if (!grouped) return [{ pattern: null, verbs: items }];
    return PATTERN_ORDER.map((p) => ({ pattern: p, verbs: items.filter((v) => v.pattern === p) })).filter((g) => g.verbs.length);
  }, [data?.items, grouped]);

  return (
    <div className="grid gap-4">
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Verbs" value={data.summary.total} icon={ListChecks} />
          <Stat label="Practised" value={data.summary.practiced} icon={Dumbbell} />
          <Stat label="Known" value={data.summary.known} icon={CheckCheck} hint="three right in a row" />
          <Stat
            label="My mistakes"
            value={data.summary.mistakes}
            icon={RotateCcw}
            hint={
              data.summary.mistakes > 0 ? (
                <button type="button" className="font-medium text-primary hover:underline" onClick={onPracticeMistakes}>
                  Practise them →
                </button>
              ) : (
                "none waiting"
              )
            }
          />
        </div>
      )}

      <Segmented
        label="Level"
        value={query.level}
        onChange={(level) => set({ level })}
        options={[
          { value: "", label: "All" },
          ...LEVELS.map((code) => ({
            value: code as string,
            label: (
              <>
                {code}
                {count(code) > 0 && <span className="text-[0.6875rem] text-fg-muted tabular-nums">{count(code)}</span>}
              </>
            ),
            disabled: !!data && count(code) === 0,
          })),
        ]}
      />
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input
          type="search"
          value={query.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search any form, or the Uzbek or Russian meaning"
          aria-label="Search verbs"
          className="h-10 pr-9 pl-9"
        />
        {query.q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => set({ q: "" })}
            className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <NativeSelect value={query.pattern} onChange={(e) => set({ pattern: e.target.value })} aria-label="Pattern">
          <option value="">Every pattern</option>
          {PATTERN_ORDER.map((p) => (
            <option key={p} value={p}>
              {PATTERNS[p].example}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          value={query.show}
          onChange={(e) => set({ show: e.target.value as IrregularVerbQuery["show"] })}
          aria-label="Show"
        >
          <option value="">All verbs</option>
          <option value="mistakes">My mistakes</option>
          <option value="known">Known</option>
          <option value="new">Not practised yet</option>
        </NativeSelect>
        <NativeSelect value={hide} onChange={(e) => setHide(e.target.value as Hide)} aria-label="Memorise">
          <option value="">Show everything</option>
          <option value="forms">Hide past forms — test yourself</option>
          <option value="translations">Hide translations</option>
        </NativeSelect>
        <NativeSelect
          value={grouped ? "pattern" : "level"}
          onChange={(e) => setGrouped(e.target.value === "pattern")}
          aria-label="Group"
        >
          <option value="pattern">Grouped by pattern</option>
          <option value="level">One list, by level</option>
        </NativeSelect>
      </div>

      {table.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : table.isError ? (
        <ErrorState error={table.error} onRetry={() => void table.refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={Shuffle} title="No verbs match" description="Try another search, level or pattern." />
      ) : (
        <div className="grid gap-5">
          {groups.map((g) => (
            <section key={g.pattern ?? "all"} className="grid gap-2">
              {g.pattern && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
                  <h3 className="text-label">{PATTERNS[g.pattern].title}</h3>
                  <span className="font-mono text-caption text-primary">{PATTERNS[g.pattern].example}</span>
                  <span className="text-caption text-fg-muted">
                    {g.verbs.length} · {PATTERNS[g.pattern].uz}
                  </span>
                </div>
              )}
              <div className="overflow-hidden rounded-xl border bg-surface">
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] gap-x-3 border-b px-4 py-2 text-caption font-medium text-fg-muted md:grid">
                  <span>Base form</span>
                  <span>Past Simple</span>
                  <span>Past Participle</span>
                  <span className="flex items-center gap-1.5">
                    <FlagUZ title="O'zbekcha" /> O&apos;zbekcha
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FlagRU title="Русский" /> Русский
                  </span>
                  <span />
                </div>
                <ul>
                  {g.verbs.map((v) => (
                    <VerbRow key={v.id} verb={v} hide={hide} />
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** A form, with each accepted spelling sayable; hidden behind dots until tapped when testing. */
function Form({ form, hidden, label }: { form: string; hidden: boolean; label: string }) {
  const [shown, setShown] = useState(false);
  if (hidden && !shown) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShown(true);
        }}
        aria-label={`Show the ${label}`}
        className="flex items-center gap-1.5 rounded text-fg-muted outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span className="tracking-widest select-none">••••••</span>
        <Eye className="size-3.5" aria-hidden />
      </button>
    );
  }
  const variants = form.split("/").map((f) => f.trim());
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
      {variants.map((f, i) => (
        <span key={f} className="flex items-center gap-0.5">
          {i > 0 && <span className="mr-1 text-fg-muted">/</span>}
          <span className="font-medium">{f}</span>
          <SpeakButton text={f} />
        </span>
      ))}
    </span>
  );
}

function VerbRow({ verb, hide }: { verb: IrregularVerb; hide: Hide }) {
  const [open, setOpen] = useState(false);
  const dot = STATE_DOT[verb.state];
  const ex = verb.examples;
  return (
    <li className="border-b last:border-b-0">
      <div
        onClick={() => setOpen(!open)}
        className="grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-1 px-4 py-2 text-body-sm transition-colors duration-micro hover:bg-surface-hover/50 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem]"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("size-2 shrink-0 rounded-full", dot.className)} title={dot.label} aria-label={dot.label} />
          <button
            type="button"
            aria-expanded={open}
            className="truncate rounded text-left font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            {verb.base}
          </button>
          <SpeakButton text={verb.base} />
          <LevelTag level={verb.level} className="hidden sm:inline-flex" />
        </span>
        <Form key={`p${hide}`} form={verb.past} hidden={hide === "forms"} label="past simple" />
        <Form key={`pp${hide}`} form={verb.past_participle} hidden={hide === "forms"} label="past participle" />
        <span className="hidden min-w-0 truncate md:block">{hide === "translations" ? "••••" : verb.uz}</span>
        <span className="hidden min-w-0 items-center gap-1 md:flex">
          <span className="truncate">{hide === "translations" ? "••••" : verb.ru}</span>
          {hide !== "translations" && verb.ru && <SpeakButton text={verb.ru.split(",")[0]!} lang="ru-RU" />}
        </span>
        <ChevronRight
          className={cn("size-4 justify-self-end text-fg-muted transition-transform duration-micro", open && "rotate-90")}
          aria-hidden
        />
      </div>
      {open && (
        <div className="grid gap-2 border-t bg-surface-hover/40 px-4 py-3 text-body-sm">
          <p className="flex flex-wrap gap-x-4 gap-y-1 md:hidden">
            <span className="flex items-center gap-1.5">
              <FlagUZ title="O'zbekcha" /> {verb.uz}
            </span>
            <span className="flex items-center gap-1.5">
              <FlagRU title="Русский" /> {verb.ru}
            </span>
          </p>
          <p className="text-caption text-fg-muted">
            {LEVEL_NAMES[verb.level]} · {PATTERNS[verb.pattern].title}
            {verb.correct + verb.wrong > 0 && ` · ${verb.correct} right, ${verb.wrong} wrong in practice`}
          </p>
          {verb.note && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
              <Info className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
              {verb.note}
            </p>
          )}
          {ex.base ? (
            <ul className="grid gap-1.5">
              {(
                [
                  ["Base", ex.base],
                  ["Past Simple", ex.past],
                  ["Past Participle", ex.participle],
                ] as const
              ).map(
                ([label, sentence]) =>
                  sentence && (
                    <li key={label} className="flex items-start gap-2">
                      <span className="w-28 shrink-0 text-caption text-fg-muted">{label}</span>
                      <span className="italic">“{sentence}”</span>
                      <SpeakButton text={sentence} className="ml-auto" />
                    </li>
                  ),
              )}
            </ul>
          ) : (
            <p className="text-caption text-fg-muted">Example sentences are being written — they appear next time.</p>
          )}
        </div>
      )}
    </li>
  );
}

// ---- Practice -------------------------------------------------------------------------------

interface Result {
  verb: IrregularVerb;
  check: VerbCheck;
  past: string;
  participle: string;
}

/**
 * A round: the base form and its meaning are shown, the learner types the past simple and the
 * past participle. Mistakes are asked first, verbs never practised next.
 */
function Practice({ startWithMistakes }: { startWithMistakes: boolean }) {
  const client = useQueryClient();
  const [level, setLevel] = useState("");
  const [pattern, setPattern] = useState("");
  const [onlyMistakes, setOnlyMistakes] = useState(startWithMistakes);
  const [count, setCount] = useState(10);
  const [round, setRound] = useState<IrregularVerb[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  const start = async (mistakes = onlyMistakes) => {
    setStarting(true);
    setStartError(null);
    try {
      const r = await learnerApi.irregularPractice({ level, pattern, show: mistakes ? "mistakes" : "", count });
      if (r.items.length === 0) {
        setStartError(mistakes ? "No mistakes waiting — practise everything instead." : "No verbs match these settings.");
        return;
      }
      setRound(r.items);
      setIndex(0);
      setResults([]);
    } catch (e) {
      setStartError(isApiError(e) ? e.message : "Could not start. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const finish = () => {
    void client.invalidateQueries({ queryKey: ["vocabulary", "irregular"] });
  };

  if (!round) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4 rounded-xl border bg-surface p-5">
        <div className="grid gap-1">
          <h2 className="flex items-center gap-2 text-h4">
            <Dumbbell className="size-4 text-primary" aria-hidden /> Practice
          </h2>
          <p className="text-body-sm text-fg-secondary">
            You see the verb and its meaning; type the Past Simple and the Past Participle. Verbs you got wrong come first.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <NativeSelect value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
            <option value="">Every level</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l} · {LEVEL_NAMES[l]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Pattern">
            <option value="">Every pattern</option>
            {PATTERN_ORDER.map((p) => (
              <option key={p} value={p}>
                {PATTERNS[p].example}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many">
            {[10, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n} verbs
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={onlyMistakes}
            onChange={(e) => setOnlyMistakes(e.target.checked)}
            className="size-4 accent-(--color-primary)"
          />
          Only my mistakes
        </label>
        {startError && <p className="text-body-sm text-error">{startError}</p>}
        <Button size="lg" loading={starting} onClick={() => void start()}>
          <Play aria-hidden /> Start
        </Button>
      </div>
    );
  }

  if (index >= round.length) {
    const right = results.filter((r) => r.check.correct).length;
    const wrong = results.filter((r) => !r.check.correct);
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4 rounded-xl border bg-surface p-6">
        <div className="grid justify-items-center gap-1 text-center">
          <p className="text-display tabular-nums">
            {right}/{results.length}
          </p>
          <p className="text-body text-fg-secondary">
            {wrong.length === 0 ? "Every one right." : "Here is what to look at again."}
          </p>
        </div>
        {wrong.length > 0 && (
          <ul className="grid gap-1.5">
            {wrong.map((r) => (
              <li
                key={r.verb.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2 text-body-sm"
              >
                <span className="font-semibold">{r.verb.base}</span>
                <span className="text-success">
                  {r.verb.past} – {r.verb.past_participle}
                </span>
                <span className="text-caption text-fg-muted line-through">
                  {r.past || "—"} – {r.participle || "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {wrong.length > 0 && (
            <Button onClick={() => (finish(), void start(true))} loading={starting}>
              <RotateCcw aria-hidden /> Practise my mistakes
            </Button>
          )}
          <Button variant="outline" onClick={() => (finish(), void start())} loading={starting}>
            New round
          </Button>
          <Button variant="ghost" onClick={() => (finish(), setRound(null))}>
            Settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Question
      key={`${index}-${round[index]!.id}`}
      verb={round[index]!}
      position={index + 1}
      total={round.length}
      onDone={(r) => {
        setResults((rs) => [...rs, r]);
        setIndex((i) => i + 1);
      }}
      onQuit={() => (finish(), setRound(null))}
    />
  );
}

function Question({
  verb,
  position,
  total,
  onDone,
  onQuit,
}: {
  verb: IrregularVerb;
  position: number;
  total: number;
  onDone: (result: Result) => void;
  onQuit: () => void;
}) {
  const answer = useAnswerVerb();
  const [past, setPast] = useState("");
  const [participle, setParticiple] = useState("");
  const [showMeaning, setShowMeaning] = useState(true);
  const next = useRef<HTMLButtonElement>(null);
  const check = answer.data;
  const progress = Math.round(((position - 1) / total) * 100);

  const submit = () => {
    if (check) {
      onDone({ verb, check, past, participle });
      return;
    }
    answer.mutate({ id: verb.id, past, participle }, { onSuccess: () => requestAnimationFrame(() => next.current?.focus()) });
  };

  const field = (label: string, value: string, set: (v: string) => void, right: boolean | undefined, correct: string) => (
    <label className="grid gap-1">
      <span className="text-caption font-medium text-fg-muted">{label}</span>
      <Input
        value={value}
        onChange={(e) => set(e.target.value)}
        readOnly={!!check}
        // Straight into typing: a round is answered from the keyboard, Enter to check and go on.
        autoFocus={label === "Past Simple"}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className={cn(
          "h-11 text-body",
          right === true && "border-success bg-success/10",
          right === false && "border-error bg-error/10",
        )}
      />
      {right === false && (
        <span className="flex items-center gap-1 text-body-sm text-success">
          <Check className="size-3.5" aria-hidden /> {correct}
        </span>
      )}
    </label>
  );

  return (
    <form
      className="mx-auto grid w-full max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onQuit}>
          End
        </Button>
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-surface-active"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-normal" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-caption text-fg-muted tabular-nums">
          {position} / {total}
        </span>
      </div>

      <div className="grid gap-5 rounded-2xl border bg-surface p-6">
        <div className="grid justify-items-center gap-1 text-center">
          <div className="flex items-center gap-2">
            <LevelTag level={verb.level} />
            <span className="text-caption text-fg-muted">{PATTERNS[verb.pattern].title}</span>
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-display">{verb.base}</h2>
            <SpeakButton text={verb.base} />
          </div>
          <button
            type="button"
            onClick={() => setShowMeaning(!showMeaning)}
            className="flex items-center gap-1.5 rounded text-body-sm text-fg-secondary outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            {showMeaning ? (
              <>
                <FlagUZ title="O'zbekcha" /> {verb.uz} <EyeOff className="size-3.5 text-fg-muted" aria-label="hide" />
              </>
            ) : (
              <>
                meaning hidden <Eye className="size-3.5" aria-hidden />
              </>
            )}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("Past Simple", past, setPast, check?.past_right, check?.past ?? "")}
          {field("Past Participle", participle, setParticiple, check?.past_participle_right, check?.past_participle ?? "")}
        </div>
        {check && (
          <div className={cn("grid gap-2 rounded-lg px-3 py-2 text-body-sm", check.correct ? "bg-success/10" : "bg-error/10")}>
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {check.correct ? "Right!" : "Not quite."}
              <span className="font-mono">
                {verb.base} – {check.past} – {check.past_participle}
              </span>
              <SpeakButton text={`${verb.base}, ${check.past.split("/")[0]}, ${check.past_participle.split("/")[0]}`} />
            </p>
            {verb.note && <p className="text-fg-secondary">{verb.note}</p>}
            {verb.examples.past && <p className="text-fg-secondary italic">“{verb.examples.past}”</p>}
          </div>
        )}
        {answer.isError && <p className="text-body-sm text-error">Could not check the answer. Please try again.</p>}
        <Button
          ref={next}
          type="submit"
          size="lg"
          loading={answer.isPending}
          disabled={!check && !past.trim() && !participle.trim()}
        >
          {check ? (position === total ? "See results" : "Next") : "Check"}
          <kbd className="ml-1 rounded border px-1 text-[0.6875rem] opacity-70">Enter</kbd>
        </Button>
      </div>
    </form>
  );
}
