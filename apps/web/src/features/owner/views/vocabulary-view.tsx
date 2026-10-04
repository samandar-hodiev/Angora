"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookA, Check, ChevronRight, Pencil, Plus, Send, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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

interface Word {
  id: string;
  term: string;
  part_of_speech: string;
  definition: string;
  examples: string[];
  pronunciation_ipa: string;
  level: CEFRLevel | null;
  tags: string[];
  translations: { uz?: string; ru?: string };
  /** The word explained per CEFR level. */
  level_content: Partial<Record<CEFRLevel, LevelText>>;
  status: "draft" | "review" | "published" | "archived";
  source: "ai" | "curated";
  learners: number;
  updated_at: string;
}

interface LevelText {
  definition: string;
  examples: string[];
}

interface VocabularyPage {
  items: Word[];
  summary: {
    total: number;
    draft: number;
    published: number;
    by_level: Record<string, number>;
    drafts_by_level: Record<string, number>;
  };
}

type StatusFilter = "all" | "draft" | "published" | "archived";
type LevelFilter = "all" | CEFRLevel;

const partsOfSpeech = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "phrasal verb",
  "idiom",
  "phrase",
  "preposition",
  "conjunction",
  "pronoun",
  "determiner",
];

const PAGE_SIZE = 25;
const JOB_KEY = "engora-vocabulary-generation";

const vocabularyApi = {
  list: (query: Record<string, string | number>) =>
    apiClient.request<VocabularyPage>("/admin/vocabulary", { method: "GET", query }),
  create: (input: WordInput) => apiClient.post<Word>("/admin/vocabulary", input),
  update: (id: string, input: WordInput) => apiClient.patch<Word>(`/admin/vocabulary/${id}`, input),
  status: (id: string, status: Word["status"]) => apiClient.post<Word>(`/admin/vocabulary/${id}/status`, { status }),
  publish: (input: { level?: string; ids?: string[] }) =>
    apiClient.post<{ published: number }>("/admin/vocabulary/publish", input),
  generate: (input: { count: number; levels: string[]; theme?: string }) =>
    apiClient.post<{ job_id?: string; added?: number }>("/admin/vocabulary/generate", input),
  job: (id: string) =>
    apiClient.get<
      JobState & { result?: { added?: number; requested?: number; skipped_duplicates?: number; failed_batches?: number } }
    >(`/jobs/${id}`),
};

interface WordInput {
  term: string;
  part_of_speech: string;
  pronunciation_ipa: string;
  /** How hard the word itself is. */
  level: CEFRLevel;
  tags: string[];
  translations: { uz: string; ru: string };
  level_content: Partial<Record<CEFRLevel, LevelText>>;
}

function readJob(): string | null {
  try {
    return window.localStorage.getItem(JOB_KEY);
  } catch {
    return null;
  }
}

function writeJob(id: string | null) {
  try {
    if (id) window.localStorage.setItem(JOB_KEY, id);
    else window.localStorage.removeItem(JOB_KEY);
  } catch {
    /* private mode: a reload simply forgets the running job */
  }
}

export function VocabularyView() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<Word | "new" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // A generation keeps running if the page is left; coming back picks it up again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobId(readJob());
  }, []);

  // The library at a glance: the counts the header, the tiles and each level's section show.
  const list = useQuery({
    queryKey: ["owner", "vocabulary", "summary"],
    queryFn: () => vocabularyApi.list({ page: 1, page_size: 1 }),
    placeholderData: (previous) => previous,
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
    writeJob(null);
    if (jobStatus === "succeeded") {
      const r = job.data?.result ?? {};
      const total = r.added ?? 0;
      const short = (r.requested ?? total) - total;
      toast({
        title: `${total} new ${total === 1 ? "word" : "words"} written as drafts`,
        description:
          (r.skipped_duplicates ? `${r.skipped_duplicates} already in the library were skipped. ` : "") +
          (short > 0 ? `${short} fewer than asked — generate again for the rest.` : "Read them, then publish."),
        variant: short > 0 ? "default" : "success",
      });
      // Shows the new drafts: the reason to look at the list now.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("draft");
    } else {
      toast({ title: "AI vocabulary generation failed", description: "Nothing was changed. Please try again.", variant: "error" });
    }
    refresh();
    setJobId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobStatus, job.isError]);

  const generate = useMutation({
    mutationFn: vocabularyApi.generate,
    onSuccess: (started) => {
      if (started.job_id) {
        writeJob(started.job_id);
        setJobId(started.job_id);
      } else {
        refresh();
      }
    },
    onError: (error) =>
      toast({ title: "Generation could not start", description: isApiError(error) ? error.message : undefined, variant: "error" }),
  });
  const setWordStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Word["status"] }) => vocabularyApi.status(id, status),
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
  const filters = { q: search, status: status === "all" ? "" : status };
  const shownLevels = level === "all" ? cefrLevels : [level];
  const busy = Boolean(jobId) || generate.isPending;

  const columns: Column<Word>[] = [
    {
      key: "word",
      header: "Word",
      cell: (w) => (
        <div className="grid gap-0.5">
          <span className="font-medium">{w.term}</span>
          <span className="text-caption text-fg-muted">
            {w.part_of_speech}
            {w.pronunciation_ipa && ` · ${w.pronunciation_ipa}`}
          </span>
        </div>
      ),
    },
    {
      key: "meaning",
      header: "Meaning",
      hideBelow: "md",
      cell: (w) => (
        <div className="grid max-w-md gap-0.5">
          <span className="line-clamp-2 text-body-sm">{w.definition}</span>
          {Object.keys(w.level_content).length > 1 && (
            <span className="text-caption text-fg-muted">
              Explained for {cefrLevels.filter((c) => w.level_content[c]).join(" · ")}
            </span>
          )}
          {(w.translations.uz || w.translations.ru) && (
            <span className="text-caption text-fg-muted">
              {[w.translations.uz && `uz: ${w.translations.uz}`, w.translations.ru && `ru: ${w.translations.ru}`]
                .filter(Boolean)
                .join(" · ")}
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
        </span>
      ),
      width: "9rem",
    },
    { key: "learners", header: "Learners", hideBelow: "lg", align: "right", cell: (w) => w.learners, width: "6rem" },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      align: "right",
      width: "4rem",
      cell: (w) => (
        <ActionMenu
          label={`Actions for ${w.term}`}
          items={[
            { label: "Edit", icon: Pencil, onSelect: () => setEditing(w) },
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
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <OwnerPageHeader
        title="Vocabulary"
        description="Every word learners can be given — written by hand or by AI for each level, and live once you publish it."
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Content CMS", href: "/owner/content" },
          { label: "Vocabulary" },
        ]}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add word
            </Button>
            <Button variant="outline" disabled={busy} loading={busy} onClick={() => setGenerating(true)}>
              <Sparkles aria-hidden /> Generate with AI
            </Button>
            <Button
              disabled={!summary || summary.draft === 0 || publishAll.isPending}
              loading={publishAll.isPending}
              onClick={() => publishAll.mutate({ level: level === "all" ? undefined : level })}
            >
              <Send aria-hidden />
              Publish {level === "all" ? "all" : level} drafts{summary && summary.draft > 0 ? ` (${level === "all" ? summary.draft : "…"})` : ""}
            </Button>
          </>
        }
      />

      {jobId && (
        <div
          role="status"
          className="mb-4 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary-subtle/40 px-4 py-3 text-body-sm"
        >
          <Sparkles className="size-4 animate-pulse text-primary" aria-hidden />
          Writing new words for each level — they appear here as drafts when they are ready. You can leave this page.
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <SummaryTile label="In the library" value={summary?.total} />
        <SummaryTile label="Waiting to publish" value={summary?.draft} tone={summary && summary.draft > 0 ? "warning" : undefined} />
        <SummaryTile label="Live for learners" value={summary?.published} tone="success" />
      </div>

      <FilterBar
        resultLabel={summary ? `${summary.total} ${summary.total === 1 ? "word" : "words"}` : undefined}
        onReset={() => {
          setSearch("");
          setLevel("all");
          setStatus("all");
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
      </FilterBar>

      <div className="mt-4 grid gap-3">
        {shownLevels.map((code, i) => (
          <LevelSection
            key={code}
            level={code}
            filters={filters}
            count={summary?.by_level[code] ?? 0}
            drafts={summary?.drafts_by_level?.[code] ?? 0}
            columns={columns}
            // A single chosen level, or a search, opens straight away; otherwise the first
            // level with drafts waiting does — that is where the work is.
            defaultOpen={
              level !== "all" ||
              Boolean(search) ||
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
        onGenerate={(input) => {
          setGenerating(false);
          generate.mutate(input);
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
  filters: { q: string; status: string };
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
  const total = list.data?.meta?.total ?? count;
  const searching = Boolean(filters.q || filters.status);
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
        <ChevronRight className={cn("size-4 shrink-0 text-fg-muted transition-transform duration-micro", open && "rotate-90")} aria-hidden />
        <LevelBadge level={level} />
        <span className="text-body-sm text-fg-secondary tabular-nums">
          {searching && list.data ? `${total} matching` : `${count} ${count === 1 ? "word" : "words"}`}
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
      translations: { uz: word?.translations.uz ?? "", ru: word?.translations.ru ?? "" },
      level_content: content,
    };
  });
  const [tab, setTab] = useState<CEFRLevel>(() => (word?.level && form.level_content[word.level] ? word.level : (Object.keys(form.level_content)[0] as CEFRLevel) ?? "B1"));
  const set = (patch: Partial<WordInput>) => setForm((f) => ({ ...f, ...patch }));
  const current = form.level_content[tab] ?? { definition: "", examples: [""] };
  const setLevelText = (patch: Partial<LevelText>) =>
    set({ level_content: { ...form.level_content, [tab]: { ...current, ...patch } } });

  const save = useMutation({
    mutationFn: () => {
      const content: Partial<Record<CEFRLevel, LevelText>> = {};
      for (const code of cefrLevels) {
        const t = form.level_content[code];
        if (t && t.definition.trim()) content[code] = { definition: t.definition.trim(), examples: t.examples.filter((e) => e.trim()) };
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
        <div className="grid gap-3 sm:grid-cols-3">
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
            <p className="text-caption text-fg-muted">A learner sees the one for their own level — simpler at A1, fuller at C1.</p>
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
                    tab === code ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
                  )}
                >
                  {code}
                  <span className={cn("text-[0.625rem] font-normal", has ? "text-success" : "text-fg-muted")}>{has ? "written" : "empty"}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="word-definition">{tab} definition — in English a {tab} learner can read</Label>
            <Textarea id="word-definition" rows={2} value={current.definition} onChange={(e) => setLevelText({ definition: e.target.value })} />
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
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryTotal: number;
  onGenerate: (input: { count: number; levels: string[]; theme?: string }) => void;
}) {
  const [levels, setLevels] = useState<CEFRLevel[]>([...cefrLevels]);
  const [count, setCount] = useState<number>(20);
  const [theme, setTheme] = useState("");
  const toggle = (code: CEFRLevel) => setLevels(levels.includes(code) ? levels.filter((l) => l !== code) : [...levels, code]);
  const valid = levels.length > 0 && count >= 10 && count <= 100;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      title="Generate vocabulary with AI"
      description="New words, each explained separately for every level you pick, with examples, pronunciation and the word in Uzbek and Russian — as drafts for you to read."
      confirmLabel="Generate"
      disabled={!valid}
      onConfirm={() => onGenerate({ count, levels, theme: theme.trim() || undefined })}
      footerStart={
        valid
          ? `${count} new words × ${levels.length} ${levels.length === 1 ? "level" : "levels"} of explanation`
          : "Pick at least one level and 10–100 words"
      }
    >
      <div className="grid gap-5">
        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="vocab-count">How many new words</Label>
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
                  count === n ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
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
              aria-describedby="vocab-count-hint"
            />
          </div>
          <p id="vocab-count-hint" className={cn("text-caption", valid || levels.length === 0 ? "text-fg-muted" : "text-error")}>
            {count < 10 || count > 100 ? "Choose between 10 and 100 words." : "Each word is one entry, with its own explanation for every level below."}
          </p>
        </section>

        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label">Explain each word for</h3>
            <button
              type="button"
              className="text-caption font-medium text-primary hover:underline"
              onClick={() => setLevels(levels.length === cefrLevels.length ? [] : [...cefrLevels])}
            >
              {levels.length === cefrLevels.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {cefrLevels.map((code) => {
              const on = levels.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(code)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-body font-semibold outline-none transition-colors duration-micro",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    on ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
                  )}
                >
                  {code}
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-1.5">
          <Label htmlFor="vocab-theme">Theme — optional</Label>
          <Input
            id="vocab-theme"
            placeholder="travel, work, feelings… leave empty for a mix"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </section>

        <p className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary-subtle/40 px-3 py-2 text-caption">
          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          Never repeats a word: all {libraryTotal} words already in the library are left out, and no word appears twice in one run.
        </p>
      </div>
    </ConfirmDialog>
  );
}
