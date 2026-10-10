"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookA, Check, ChevronRight, Pencil, Plus, Send, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Highlight } from "@/components/common/highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { apiClient, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { DataTable, Pagination, type Column } from "../components/data-table";
import {
  ActionMenu,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  LevelBadge,
  OwnerPageHeader,
  SearchInput,
  StatusBadge,
} from "../components/primitives";
import { cefrLevels } from "../types";
import type { CEFRLevel, JobState } from "../types";

/**
 * The vocabulary library.
 *
 * Words are content like the grammar is: added by hand or generated for every level at once,
 * landing as drafts, and reaching learners when they are published — a published word goes
 * into the decks of learners at its level. Each word carries its meaning in Uzbek and Russian
 * beside the English definition, because that is who is learning it.
 */

type Kind = "word" | "phrase" | "collocation";

interface Word {
  id: string;
  term: string;
  kind: Kind;
  part_of_speech: string;
  definition: string;
  examples: string[];
  pronunciation_ipa: string;
  level: CEFRLevel | null;
  tags: string[];
  translations: { uz?: string; ru?: string; ru_pron?: string };
  /** The word explained per CEFR level. */
  level_content: Partial<Record<CEFRLevel, LevelText>>;
  senses: { definition: string; level: string; example: string }[];
  register: string;
  /** list: from a level word list; ai_checked: confirmed by a second check; ai: unverified; curated: set by an editor. */
  level_source: "list" | "ai_checked" | "ai" | "curated";
  status: "draft" | "review" | "published" | "archived";
  source: "ai" | "curated";
  learners: number;
  updated_at: string;
}

interface LevelText {
  definition: string;
  examples: string[];
  /** The lower level whose explanation this one shares. */
  same_as?: string;
}

interface VocabularyPage {
  items: Word[];
  summary: {
    unverified: number;
    total: number;
    draft: number;
    published: number;
    by_level: Record<string, number>;
    drafts_by_level: Record<string, number>;
  };
}

type StatusFilter = "all" | "draft" | "published" | "archived";
type LevelFilter = "all" | CEFRLevel;

/** What part_of_speech holds for each kind: a word class, a phrase type, a collocation's pattern. */
const partsOfSpeechByKind: Record<Kind, string[]> = {
  word: ["noun", "verb", "adjective", "adverb", "preposition", "conjunction", "pronoun", "determiner"],
  phrase: ["phrasal verb", "idiom", "phrase"],
  collocation: [
    "verb + noun",
    "adjective + noun",
    "adverb + adjective",
    "adverb + verb",
    "noun + noun",
    "verb + preposition",
    "noun + preposition",
    "verb + adverb",
  ],
};
const partsOfSpeech = Object.values(partsOfSpeechByKind).flat();

const KIND_LABEL: Record<Kind, { tab: string; one: string; many: string }> = {
  word: { tab: "Words", one: "word", many: "words" },
  phrase: { tab: "Phrases", one: "phrase", many: "phrases" },
  collocation: { tab: "Collocations", one: "collocation", many: "collocations" },
};

/** The topics a generation offers; an owner may add their own. */
const TOPICS = [
  "nature",
  "animals",
  "plants",
  "weather",
  "environment",
  "work",
  "business",
  "money",
  "travel",
  "transport",
  "city",
  "home",
  "family",
  "people",
  "feelings",
  "personality",
  "food",
  "health",
  "body",
  "sport",
  "education",
  "science",
  "technology",
  "media",
  "art",
  "music",
  "shopping",
  "clothes",
  "society",
  "time",
];

const REGISTERS = ["formal", "neutral", "informal", "spoken", "written", "technical", "literary", "slang"];

const LEVEL_SOURCE: Record<Word["level_source"], { label: string; title: string; variant: "success" | "outline" | "warning" }> = {
  list: { label: "Listed", title: "Level taken from a level word list", variant: "success" },
  ai_checked: {
    label: "Checked",
    title: "Level written by the AI and confirmed by a second, independent check",
    variant: "outline",
  },
  ai: { label: "Unconfirmed", title: "The two AI checks disagreed — confirm or correct the level", variant: "warning" },
  curated: { label: "Set by you", title: "Level set by an editor", variant: "outline" },
};

const PAGE_SIZE = 25;
const JOB_KEY = "engora-vocabulary-generation";

const vocabularyApi = {
  list: (query: Record<string, string | number>) =>
    apiClient.request<VocabularyPage>("/admin/vocabulary", { method: "GET", query }),
  create: (input: WordInput) => apiClient.post<Word>("/admin/vocabulary", input),
  update: (id: string, input: WordInput) => apiClient.patch<Word>(`/admin/vocabulary/${id}`, input),
  status: (id: string, status: Word["status"]) => apiClient.post<Word>(`/admin/vocabulary/${id}/status`, { status }),
  setLevel: (id: string, level: CEFRLevel) => apiClient.post<Word>(`/admin/vocabulary/${id}/level`, { level }),
  /** Removes the entry for good, with learners' review history on it. */
  remove: (id: string) => apiClient.delete<{ deleted: string }>(`/admin/vocabulary/${id}`),
  publish: (input: { level?: string; ids?: string[]; kind?: Kind }) =>
    apiClient.post<{ published: number }>("/admin/vocabulary/publish", input),
  generate: (input: GenerateInput) => apiClient.post<{ job_id?: string; added?: number }>("/admin/vocabulary/generate", input),
  job: (id: string) =>
    apiClient.get<
      JobState & { result?: { added?: number; requested?: number; skipped_duplicates?: number; failed_batches?: number; rejected?: number } }
    >(`/jobs/${id}`),
};

interface GenerateInput {
  count: number;
  kind: Kind;
  topics: string[];
  min_level?: CEFRLevel;
  max_level?: CEFRLevel;
}

interface WordInput {
  term: string;
  part_of_speech: string;
  pronunciation_ipa: string;
  /** How hard the word itself is. */
  level: CEFRLevel;
  tags: string[];
  translations: { uz: string; ru: string; ru_pron: string };
  level_content: Partial<Record<CEFRLevel, LevelText>>;
}

/** A generation in progress: enough to show how far it has got after a reload. */
interface RunningJob {
  id: string;
  /** Words in the library when it started; the new ones are everything above this. */
  startTotal: number;
  count: number;
  kind?: Kind;
  topics?: string[];
  startedAt: number;
}

/** A running generation is remembered per kind, so the Phrases page does not show a run of words. */
function readJob(kind: Kind): RunningJob | null {
  try {
    const raw = window.localStorage.getItem(`${JOB_KEY}:${kind}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunningJob;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeJob(kind: Kind, job: RunningJob | null) {
  try {
    if (job) window.localStorage.setItem(`${JOB_KEY}:${kind}`, JSON.stringify(job));
    else window.localStorage.removeItem(`${JOB_KEY}:${kind}`);
  } catch {
    /* private mode: a reload simply forgets the running job */
  }
}

const KIND_PAGE: Record<Kind, { description: string; href: string }> = {
  word: {
    description:
      "Single words — each at one checked level, written by hand or by AI from the topics you pick, and live once you publish it.",
    href: "/owner/content/lexicon/vocabulary",
  },
  phrase: {
    description:
      "Phrasal verbs, idioms and fixed phrases — learned as a whole. Generated by topic, read, then published to learners.",
    href: "/owner/content/lexicon/phrases",
  },
  collocation: {
    description:
      "Words that naturally go together — make a decision, heavy rain. Generated by topic, read, then published to learners.",
    href: "/owner/content/lexicon/collocations",
  },
};

/** One kind of lexicon entry; each has its own page under Content CMS → Lexicon. */
export function VocabularyView({ kind }: { kind: Kind }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("all");
  const [register, setRegister] = useState("all");
  const [check, setCheck] = useState<"all" | "unverified">("all");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<Word | "new" | null>(null);
  const [deleting, setDeleting] = useState<Word | null>(null);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState<RunningJob | null>(null);
  const jobId = running?.id ?? null;

  // A generation keeps running if the page is left; coming back picks it up again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(readJob(kind));
  }, [kind]);

  // The library at a glance: the counts the header, the tiles and each level's section show.
  const list = useQuery({
    queryKey: ["owner", "vocabulary", "summary", kind],
    queryFn: () => vocabularyApi.list({ page: 1, page_size: 1, kind }),
    placeholderData: (previous) => previous,
    // While words are being written they are saved batch by batch: polling the counts is
    // what moves the progress bar.
    refetchInterval: () => (readJob(kind) ? 2500 : false),
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ["owner", "vocabulary"] });

  const job = useQuery({
    queryKey: ["owner", "vocabulary-job", jobId ?? ""],
    queryFn: () => vocabularyApi.job(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (q) => (q.state.data?.status === "succeeded" || q.state.data?.status === "failed" ? false : 2000),
  });
  const jobStatus = job.data?.status;
  useEffect(() => {
    if (!jobId || !(jobStatus === "succeeded" || jobStatus === "failed" || job.isError)) return;
    writeJob(kind, null);
    if (jobStatus === "succeeded") {
      const r = job.data?.result ?? {};
      const total = r.added ?? 0;
      const short = (r.requested ?? total) - total;
      toast({
        title: `${total} new ${KIND_LABEL[kind][total === 1 ? "one" : "many"]} written as drafts`,
        description:
          (r.skipped_duplicates ? `${r.skipped_duplicates} already in the library were skipped. ` : "") +
          (r.rejected ? `${r.rejected} failed the editor's check (wrong kind, translation or spelling) and were left out. ` : "") +
          (short > 0 ? `${short} fewer than asked — generate again for the rest.` : "Read them, then publish."),
        variant: short > 0 ? "default" : "success",
      });
      // Shows the new drafts: the reason to look at the list now.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("draft");
    } else {
      toast({
        title: "AI vocabulary generation failed",
        description: "Nothing was changed. Please try again.",
        variant: "error",
      });
    }
    refresh();
    setRunning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobStatus, job.isError]);

  const generate = useMutation({
    // The progress bar counts entries of the kind being written, from how many there were first.
    mutationFn: async (input: GenerateInput) => {
      const before = await vocabularyApi.list({ page: 1, page_size: 1, kind: input.kind });
      const started = await vocabularyApi.generate(input);
      return { started, startTotal: before.data.summary.total };
    },
    onSuccess: ({ started, startTotal }, input) => {
      if (started.job_id) {
        const run: RunningJob = {
          id: started.job_id,
          startTotal,
          count: input.count,
          kind: input.kind,
          topics: input.topics,
          startedAt: Date.now(),
        };
        writeJob(kind, run);
        setRunning(run);
      } else {
        refresh();
      }
    },
    onError: (error) =>
      toast({
        title: "Generation could not start",
        description: isApiError(error) ? error.message : undefined,
        variant: "error",
      }),
  });
  const setWordLevel = useMutation({
    mutationFn: ({ id, level }: { id: string; level: CEFRLevel }) => vocabularyApi.setLevel(id, level),
    onSuccess: refresh,
  });
  const setWordStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Word["status"] }) => vocabularyApi.status(id, status),
    onSuccess: refresh,
  });
  const removeWord = useMutation({
    mutationFn: (id: string) => vocabularyApi.remove(id),
    onSuccess: refresh,
  });
  const publishAll = useMutation({
    mutationFn: vocabularyApi.publish,
    onSuccess: (r) => {
      toast({ title: `${r.published} ${r.published === 1 ? "word is" : "words are"} live`, variant: "success" });
      refresh();
    },
  });

  const summary = list.data?.data.summary;
  const filters = {
    q: search,
    status: status === "all" ? "" : status,
    kind,
    topic: topic === "all" ? "" : topic,
    register: register === "all" ? "" : register,
    check: check === "all" ? "" : check,
  };
  const shownLevels = level === "all" ? cefrLevels : [level];
  const busy = Boolean(jobId) || generate.isPending;

  // Each level's section shows the word as it is explained for that level.
  const columnsFor = (shownLevel: CEFRLevel): Column<Word>[] => [
    {
      key: "word",
      header: "Word",
      cell: (w) => (
        <div className="grid gap-0.5">
          <span className="font-medium">
            <Highlight text={w.term} query={search} />
          </span>
          <span className="text-caption text-fg-muted">
            {w.level && w.level !== shownLevel && `${w.level} · `}
            {w.part_of_speech}
            {w.register && w.register !== "neutral" && ` · ${w.register}`}
            {w.pronunciation_ipa && ` · ${w.pronunciation_ipa}`}
          </span>
          {w.tags.length > 0 && <span className="text-caption text-fg-muted capitalize">{w.tags.join(", ")}</span>}
        </div>
      ),
    },
    {
      key: "meaning",
      header: "Meaning",
      hideBelow: "md",
      cell: (w) => (
        <div className="grid max-w-md gap-0.5">
          <span className="line-clamp-2 text-body-sm">{w.definition || w.level_content[shownLevel]?.definition}</span>
          {w.senses.length > 0 && (
            <span className="text-caption text-fg-muted">
              +{w.senses.length} more {w.senses.length === 1 ? "meaning" : "meanings"} ({w.senses.map((x) => x.level).join(", ")})
            </span>
          )}
          {(w.translations.uz || w.translations.ru) && (
            <span className="text-caption text-fg-muted">
              <Highlight
                query={search}
                text={[
                  w.translations.uz && `uz: ${w.translations.uz}`,
                  w.translations.ru && `ru: ${w.translations.ru}${w.translations.ru_pron ? ` [${w.translations.ru_pron}]` : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (w) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={w.status} />
          {w.source === "ai" && w.status !== "published" && <Badge variant="outline">AI</Badge>}
          <Badge variant={LEVEL_SOURCE[w.level_source].variant} title={LEVEL_SOURCE[w.level_source].title}>
            {LEVEL_SOURCE[w.level_source].label}
          </Badge>
        </span>
      ),
      width: "12rem",
    },
    { key: "learners", header: "Learners", hideBelow: "lg", align: "right", cell: (w) => w.learners, width: "6rem" },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      align: "right",
      width: "6rem",
      cell: (w) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${w.term}`}
            title="Delete"
            className="text-fg-muted hover:text-error"
            onClick={() => setDeleting(w)}
          >
            <Trash2 aria-hidden />
          </Button>
          <ActionMenu
            label={`Actions for ${w.term}`}
            items={[
              { label: "Edit", icon: Pencil, onSelect: () => setEditing(w) },
              ...(w.level && w.level_source === "ai"
                ? [
                    {
                      label: `Confirm ${w.level}`,
                      icon: Check,
                      onSelect: () => setWordLevel.mutate({ id: w.id, level: w.level! }),
                    },
                  ]
                : []),
              w.status === "published"
                ? { label: "Unpublish", icon: Undo2, onSelect: () => setWordStatus.mutate({ id: w.id, status: "draft" }) }
                : { label: "Publish", icon: Send, onSelect: () => setWordStatus.mutate({ id: w.id, status: "published" }) },
              {
                label: w.status === "archived" ? "Restore as draft" : "Archive",
                icon: Archive,
                separatorBefore: true,
                destructive: w.status !== "archived",
                onSelect: () => setWordStatus.mutate({ id: w.id, status: w.status === "archived" ? "draft" : "archived" }),
              },
              { label: "Delete", icon: Trash2, destructive: true, onSelect: () => setDeleting(w) },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <OwnerPageHeader
        title={KIND_LABEL[kind].tab === "Words" ? "Vocabulary" : KIND_LABEL[kind].tab}
        description={KIND_PAGE[kind].description}
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Content CMS", href: "/owner/content" },
          { label: "Lexicon" },
          { label: KIND_LABEL[kind].tab === "Words" ? "Vocabulary" : KIND_LABEL[kind].tab },
        ]}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add {KIND_LABEL[kind].one}
            </Button>
            <Button variant="outline" disabled={busy} loading={busy} onClick={() => setGenerating(true)}>
              <Sparkles aria-hidden /> Generate with AI
            </Button>
            <Button
              disabled={!summary || summary.draft === 0 || publishAll.isPending}
              loading={publishAll.isPending}
              onClick={() => publishAll.mutate({ kind, level: level === "all" ? undefined : level })}
            >
              <Send aria-hidden />
              Publish {level === "all" ? "all" : level} drafts
              {summary && summary.draft > 0
                ? ` (${level === "all" ? summary.draft : (summary.drafts_by_level?.[level] ?? 0)})`
                : ""}
            </Button>
          </>
        }
      />

      {running && (
        <GeneratingPanel run={running} written={Math.max(0, (summary?.total ?? running.startTotal) - running.startTotal)} />
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="In the library" value={summary?.total} />
        <SummaryTile
          label="Waiting to publish"
          value={summary?.draft}
          tone={summary && summary.draft > 0 ? "warning" : undefined}
        />
        <SummaryTile label="Live for learners" value={summary?.published} tone="success" />
        <SummaryTile
          label="Level not confirmed"
          value={summary?.unverified}
          tone={summary && summary.unverified > 0 ? "warning" : undefined}
        />
      </div>

      <FilterBar
        resultLabel={summary ? `${summary.total} ${KIND_LABEL[kind][summary.total === 1 ? "one" : "many"]}` : undefined}
        onReset={() => {
          setSearch("");
          setLevel("all");
          setStatus("all");
          setTopic("all");
          setRegister("all");
          setCheck("all");
        }}
      >
        <SearchInput
          label="Search words"
          placeholder="Search a word or its meaning"
          value={search}
          onChange={setSearch}
          className="min-w-56 flex-1"
        />
        <FilterSelect
          label="Level"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All levels" },
            ...cefrLevels.map((code) => ({
              value: code,
              label: `${code}${summary?.by_level[code] ? ` · ${summary.by_level[code]}` : ""}`,
            })),
          ]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "Drafts and live" },
            { value: "draft", label: "Drafts" },
            { value: "published", label: "Live" },
            { value: "archived", label: "Archived" },
          ]}
        />
        <FilterSelect
          label="Topic"
          value={topic}
          onChange={setTopic}
          options={[{ value: "all", label: "Every topic" }, ...TOPICS.map((t) => ({ value: t, label: t }))]}
        />
        <FilterSelect
          label="Formality"
          value={register}
          onChange={setRegister}
          options={[{ value: "all", label: "Any formality" }, ...REGISTERS.map((r) => ({ value: r, label: r }))]}
        />
        <FilterSelect
          label="Level check"
          value={check}
          onChange={setCheck}
          options={[
            { value: "all", label: "Any level check" },
            { value: "unverified", label: `Not confirmed${summary?.unverified ? ` · ${summary.unverified}` : ""}` },
          ]}
        />
      </FilterBar>

      <div className="mt-4 grid gap-3">
        {shownLevels.map((code, i) => (
          <LevelSection
            // A new kind or narrowing filter starts every section afresh, open, so each one counts
            // what matches instead of showing the kind's totals.
            key={`${code}|${kind}|${filters.topic}|${filters.register}|${filters.check}`}
            level={code}
            filters={filters}
            count={summary?.by_level[code] ?? 0}
            drafts={summary?.drafts_by_level?.[code] ?? 0}
            columns={columnsFor(code)}
            // A single chosen level, or a search, opens straight away; otherwise the first
            // level with drafts waiting does — that is where the work is.
            defaultOpen={
              level !== "all" ||
              Boolean(search || filters.topic || filters.register || filters.check) ||
              code === (cefrLevels.find((c) => (summary?.drafts_by_level?.[c] ?? 0) > 0) ?? (i === 0 ? code : ""))
            }
            onEdit={setEditing}
            onAdd={() => setEditing("new")}
          />
        ))}
      </div>

      {editing && (
        <WordDialog
          word={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      <GenerateWordsDialog
        key={generating ? "open" : "closed"}
        open={generating}
        onOpenChange={setGenerating}
        libraryTotal={summary?.total ?? 0}
        initialKind={kind}
        onGenerate={(input) => {
          setGenerating(false);
          generate.mutate(input);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete “${deleting.term}”?` : ""}
        description={`The ${KIND_LABEL[kind].one}, its explanations at every level, its translations and learners' review history on it are removed for good. If you delete it, it has to be added again from scratch.`}
        confirmLabel="Delete"
        destructive
        loading={removeWord.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const term = deleting.term;
          removeWord.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast({ title: "Deleted", description: `“${term}” is gone from the library.`, variant: "success" });
            },
            onError: (error) =>
              toast({
                title: "It could not be deleted",
                description: isApiError(error) ? error.message : undefined,
                variant: "error",
              }),
          });
        }}
      />
    </>
  );
}

/**
 * One level's words, in a section of their own that opens and closes. The words are only
 * fetched once it is open: six levels of a few hundred words each is not one page.
 */
function LevelSection({
  level,
  filters,
  count,
  drafts,
  columns,
  defaultOpen,
  onEdit,
  onAdd,
}: {
  level: CEFRLevel;
  filters: { q: string; status: string; kind: Kind; topic: string; register: string; check: string };
  count: number;
  drafts: number;
  columns: Column<Word>[];
  defaultOpen: boolean;
  onEdit: (word: Word) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(1);
  // A new search or status starts the section from its first page, and opens it when searching.
  const [seen, setSeen] = useState(filters);
  if (seen.q !== filters.q || seen.status !== filters.status) {
    setSeen(filters);
    setPage(1);
    if (filters.q) setOpen(true);
  }
  const query = { ...filters, level, page, page_size: PAGE_SIZE };
  const list = useQuery({
    queryKey: ["owner", "vocabulary", "level", query],
    queryFn: () => vocabularyApi.list(query),
    enabled: open,
    placeholderData: (previous) => previous,
  });
  // A closed section has not fetched its list, so it counts from the summary — under the same
  // status filter as an open one, or "Drafts" would show 100 in one section and 110 in the next.
  const counted = filters.status === "draft" ? drafts : filters.status === "published" ? count - drafts : count;
  const total = list.data?.meta?.total ?? counted;
  const searching = Boolean(filters.q || filters.status || filters.topic || filters.register || filters.check);
  // While searching, a level with nothing matching gets out of the way.
  if (searching && open && list.data && total === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <ChevronRight
          className={cn("size-4 shrink-0 text-fg-muted transition-transform duration-micro", open && "rotate-90")}
          aria-hidden
        />
        <LevelBadge level={level} />
        <span className="text-body-sm text-fg-secondary tabular-nums">
          {filters.q && list.data ? `${total} matching` : `${total} ${total === 1 ? "word" : "words"}`}
        </span>
        {drafts > 0 && <Badge variant="warning">{drafts} waiting to publish</Badge>}
      </button>
      {open && (
        <div className="border-t">
          <DataTable
            caption={`${level} vocabulary`}
            columns={columns}
            rows={list.data?.data.items ?? []}
            rowKey={(w) => w.id}
            isLoading={list.isPending}
            isError={list.isError}
            error={list.error}
            onRetry={() => void list.refetch()}
            onRowClick={onEdit}
            skeletonRows={4}
            empty={
              <div className="grid justify-items-center gap-2 py-8 text-center">
                <BookA className="size-7 text-fg-muted" aria-hidden />
                <p className="text-body-sm text-fg-secondary">No {level} words yet.</p>
                <Button variant="outline" size="sm" onClick={onAdd}>
                  <Plus aria-hidden /> Add one by hand
                </Button>
              </div>
            }
          />
          {total > PAGE_SIZE && (
            <div className="border-t px-4 py-3">
              <Pagination
                page={page}
                totalPages={Math.ceil(total / PAGE_SIZE)}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                label="words"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const placeholderWidths = ["w-24", "w-32", "w-20", "w-28"];

/**
 * What the page shows while a generation runs: how many of the asked-for words are written
 * so far, and rows shimmering where the rest will land. Words are saved as each batch comes
 * back, so the bar moves in steps of about ten.
 */
function GeneratingPanel({ run, written }: { run: RunningJob; written: number }) {
  const done = Math.min(written, run.count);
  const pct = Math.round((done / Math.max(run.count, 1)) * 100);
  return (
    <section
      role="status"
      aria-live="polite"
      className="relative mb-4 grid gap-4 overflow-hidden rounded-xl border border-primary/40 bg-surface p-4"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5"
      />
      <div className="relative flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4 animate-spin [animation-duration:2.4s]" aria-hidden />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-body font-medium">
            Writing {run.count} new {KIND_LABEL[run.kind ?? "word"].many} <span className="text-fg-muted">· {done} done</span>
          </p>
          <p className="text-caption text-fg-muted">
            {run.topics?.length ? `From ${run.topics.join(", ")}. ` : "Mixed topics. "}
            Each at its own checked level, with other meanings, examples, pronunciation, Uzbek and Russian. You can leave this
            page — it keeps going.
          </p>
        </div>
        <span className="text-h4 tabular-nums text-primary">{pct}%</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-active">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700"
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
      <ul aria-hidden className="relative grid gap-2">
        {placeholderWidths.map((width, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-lg border bg-surface px-3 py-2.5"
            style={{ animationDelay: `${i * 150}ms` }}
          >
            <Skeleton className={cn("h-4 rounded", width)} />
            <Skeleton className="ml-auto hidden h-3 w-1/3 rounded sm:block" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value?: number; tone?: "warning" | "success" }) {
  return (
    <div className="grid gap-0.5 rounded-xl border bg-surface px-4 py-3">
      <span className="text-caption text-fg-muted">{label}</span>
      {/* The colour sits on an inner span: cn() reads text-h3 and a text colour as the same
          kind of class and would keep only one of them. */}
      <span className="text-h3 tabular-nums">
        <span className={cn(tone === "warning" && "text-warning-text", tone === "success" && "text-success")}>
          {value ?? "—"}
        </span>
      </span>
    </div>
  );
}

/** Adding a word by hand, or correcting one. Saving a word does not publish it. */
function WordDialog({ word, onClose, onSaved }: { word: Word | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<WordInput>(() => {
    const content: Partial<Record<CEFRLevel, LevelText>> = { ...(word?.level_content ?? {}) };
    if (Object.keys(content).length === 0) content[word?.level ?? "B1"] = { definition: word?.definition ?? "", examples: [""] };
    return {
      term: word?.term ?? "",
      part_of_speech: word?.part_of_speech ?? "noun",
      pronunciation_ipa: word?.pronunciation_ipa ?? "",
      level: word?.level ?? "B1",
      tags: word?.tags ?? [],
      translations: {
        uz: word?.translations.uz ?? "",
        ru: word?.translations.ru ?? "",
        ru_pron: word?.translations.ru_pron ?? "",
      },
      level_content: content,
    };
  });
  const [tab, setTab] = useState<CEFRLevel>(() =>
    word?.level && form.level_content[word.level] ? word.level : ((Object.keys(form.level_content)[0] as CEFRLevel) ?? "B1"),
  );
  const set = (patch: Partial<WordInput>) => setForm((f) => ({ ...f, ...patch }));
  const current = form.level_content[tab] ?? { definition: "", examples: [""] };
  // Editing a level that shared another's text gives it text of its own.
  const setLevelText = (patch: Partial<LevelText>) =>
    set({ level_content: { ...form.level_content, [tab]: { ...current, ...patch, same_as: undefined } } });

  const save = useMutation({
    mutationFn: () => {
      const content: Partial<Record<CEFRLevel, LevelText>> = {};
      for (const code of cefrLevels) {
        const t = form.level_content[code];
        if (t && t.definition.trim())
          content[code] = { definition: t.definition.trim(), examples: t.examples.filter((e) => e.trim()) };
      }
      const input = { ...form, level_content: content };
      return word ? vocabularyApi.update(word.id, input) : vocabularyApi.create(input);
    },
    onSuccess: () => {
      toast({ title: word ? "Word saved" : "Word added as a draft", variant: "success" });
      onSaved();
    },
    onError: (error) =>
      toast({ title: "It could not be saved", description: isApiError(error) ? error.message : undefined, variant: "error" }),
  });
  const explained = cefrLevels.filter((c) => form.level_content[c]?.definition.trim());
  const ready = form.term.trim().length > 0 && explained.length > 0;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      className="sm:max-w-2xl"
      title={word ? `Edit “${word.term}”` : "Add a word"}
      description={
        word
          ? "Changes to a live word reach learners straight away."
          : "Explain it for as many levels as you like — at least one. It is saved as a draft until you publish it."
      }
      confirmLabel={word ? "Save" : "Add word"}
      loading={save.isPending}
      disabled={!ready}
      onConfirm={() => save.mutate()}
      footerStart={`Explained for ${explained.length} of 6 levels`}
    >
      <div className="grid max-h-[62vh] gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_7rem]">
          <div className="grid gap-1.5">
            <Label htmlFor="word-term">Word or phrase</Label>
            <Input id="word-term" value={form.term} autoFocus onChange={(e) => set({ term: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-pos">Part of speech</Label>
            <NativeSelect id="word-pos" value={form.part_of_speech} onChange={(e) => set({ part_of_speech: e.target.value })}>
              {partsOfSpeech.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-level">Word level</Label>
            <NativeSelect id="word-level" value={form.level} onChange={(e) => set({ level: e.target.value as CEFRLevel })}>
              {cefrLevels.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="word-uz">O&apos;zbekcha</Label>
            <Input
              id="word-uz"
              value={form.translations.uz}
              onChange={(e) => set({ translations: { ...form.translations, uz: e.target.value } })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-ru">Русский</Label>
            <Input
              id="word-ru"
              value={form.translations.ru}
              onChange={(e) => set({ translations: { ...form.translations, ru: e.target.value } })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-ru-pron">Русский — talaffuzi</Label>
            <Input
              id="word-ru-pron"
              placeholder="dastích"
              value={form.translations.ru_pron}
              onChange={(e) => set({ translations: { ...form.translations, ru_pron: e.target.value } })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-ipa">Pronunciation (IPA)</Label>
            <Input
              id="word-ipa"
              placeholder="/ɪɡˈzæmpəl/"
              value={form.pronunciation_ipa}
              onChange={(e) => set({ pronunciation_ipa: e.target.value })}
            />
          </div>
        </div>

        <section className="grid gap-3 rounded-xl border p-3">
          <div className="grid gap-1">
            <h3 className="text-label">Explanation by level</h3>
            <p className="text-caption text-fg-muted">
              A learner sees the one for their own level — simpler at A1, fuller at C1.
            </p>
          </div>
          <div role="tablist" aria-label="Level" className="grid grid-cols-6 gap-1.5">
            {cefrLevels.map((code) => {
              const has = Boolean(form.level_content[code]?.definition.trim());
              return (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={tab === code}
                  onClick={() => setTab(code)}
                  className={cn(
                    "grid justify-items-center rounded-lg border px-1 py-1.5 text-body-sm font-semibold outline-none transition-colors duration-micro",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    tab === code
                      ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
                      : "bg-surface hover:bg-surface-hover",
                  )}
                >
                  {code}
                  <span className={cn("text-[0.625rem] font-normal", has ? "text-success" : "text-fg-muted")}>
                    {form.level_content[code]?.same_as ? `= ${form.level_content[code]?.same_as}` : has ? "written" : "empty"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-definition">
              {tab} definition — in English a {tab} learner can read
            </Label>
            <Textarea
              id="word-definition"
              rows={2}
              value={current.definition}
              onChange={(e) => setLevelText({ definition: e.target.value })}
            />
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-label">{tab} examples</legend>
            {(current.examples.length ? current.examples : [""]).map((example, i, list) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`${tab} example ${i + 1}`}
                  value={example}
                  placeholder="A sentence somebody would actually say."
                  onChange={(e) => setLevelText({ examples: list.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${tab} example ${i + 1}`}
                  disabled={list.length <= 1}
                  onClick={() => setLevelText({ examples: list.filter((_, j) => j !== i) })}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            {current.examples.length < 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => setLevelText({ examples: [...(current.examples.length ? current.examples : [""]), ""] })}
              >
                <Plus aria-hidden /> Add an example
              </Button>
            )}
          </fieldset>
        </section>

        <div className="grid gap-1.5">
          <Label htmlFor="word-tags">Topics</Label>
          <Input
            id="word-tags"
            placeholder="travel, work"
            value={form.tags.join(", ")}
            onChange={(e) =>
              set({
                tags: e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .slice(0, 6),
              })
            }
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}

const countPresets = [10, 25, 50, 100] as const;

/**
 * One Generate writes new words — as many as asked, 10 to 100 — and explains each one for
 * every level picked: every level by default. A word already in the library is never written
 * again.
 */
function GenerateWordsDialog({
  open,
  onOpenChange,
  libraryTotal,
  initialKind,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryTotal: number;
  initialKind: Kind;
  onGenerate: (input: GenerateInput) => void;
}) {
  // The page decides what is written: a generation on Phrases writes phrases.
  const kind = initialKind;
  const [count, setCount] = useState<number>(20);
  const [topics, setTopics] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [minLevel, setMinLevel] = useState<CEFRLevel | "">("");
  const [maxLevel, setMaxLevel] = useState<CEFRLevel | "">("");
  const toggle = (t: string) => setTopics(topics.includes(t) ? topics.filter((x) => x !== t) : [...topics, t].slice(-8));
  const addCustom = () => {
    const t = custom.trim().toLowerCase();
    if (t.length >= 2 && !topics.includes(t)) setTopics([...topics, t].slice(-8));
    setCustom("");
  };
  const valid = count >= 10 && count <= 100;
  const names = KIND_LABEL[kind];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      title="Generate with AI"
      description="New entries from the topics you pick, each explained once at its own level, with its other meanings, formality, examples, pronunciation and the meaning in Uzbek and Russian — as drafts for you to read."
      confirmLabel="Generate"
      disabled={!valid}
      onConfirm={() =>
        onGenerate({
          count,
          kind,
          topics,
          min_level: minLevel || undefined,
          max_level: maxLevel || undefined,
        })
      }
      footerStart={
        valid ? `${count} new ${names.many}${topics.length ? ` · ${topics.join(", ")}` : " · mixed topics"}` : "Choose 10–100"
      }
    >
      <div className="grid gap-5">
        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="vocab-count">How many new {names.many}</Label>
            <span className="text-caption text-fg-muted">10 – 100</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {countPresets.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
                className={cn(
                  "min-w-14 rounded-lg border px-3 py-2 text-body-sm font-medium tabular-nums outline-none transition-colors duration-micro",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  count === n
                    ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
                    : "bg-surface hover:bg-surface-hover",
                )}
              >
                {n}
              </button>
            ))}
            <Input
              id="vocab-count"
              type="number"
              min={10}
              max={100}
              step={1}
              value={count}
              onChange={(e) => setCount(Math.round(Number(e.target.value) || 0))}
              className="w-24 tabular-nums"
            />
          </div>
          {!valid && <p className="text-caption text-error">Choose between 10 and 100.</p>}
        </section>

        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label">Topics — pick any, or none for a mix</h3>
            {topics.length > 0 && (
              <button
                type="button"
                className="text-caption font-medium text-primary hover:underline"
                onClick={() => setTopics([])}
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...TOPICS, ...topics.filter((t) => !TOPICS.includes(t))].map((t) => {
              const on = topics.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(t)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-body-sm capitalize outline-none transition-colors duration-micro",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    on
                      ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
                      : "bg-surface text-fg-secondary hover:bg-surface-hover",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Your own topic — e.g. airport, cooking, job interview"
              value={custom}
              maxLength={40}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addCustom} disabled={custom.trim().length < 2}>
              <Plus aria-hidden /> Add
            </Button>
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="text-label">Level range — optional</h3>
          <div className="flex flex-wrap items-center gap-2 text-body-sm">
            <NativeSelect
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value as CEFRLevel | "")}
              aria-label="Lowest level"
            >
              <option value="">Any</option>
              {cefrLevels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <span className="text-fg-muted">to</span>
            <NativeSelect
              value={maxLevel}
              onChange={(e) => setMaxLevel(e.target.value as CEFRLevel | "")}
              aria-label="Highest level"
            >
              <option value="">Any</option>
              {cefrLevels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className="text-caption text-fg-muted">
            Leave both on Any and the AI writes whatever fits the topic; every entry is still labelled with its own level.
          </p>
        </section>

        <p className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary-subtle/40 px-3 py-2 text-caption">
          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          Each level is checked: taken from the level word list where it is listed, otherwise confirmed by a second, independent
          AI check — anything the two disagree on is marked “Unconfirmed” for you. Nothing already in the library ({
            libraryTotal
          }{" "}
          entries) is written again.
        </p>
      </div>
    </ConfirmDialog>
  );
}
