"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookA, Check, Pencil, Plus, Send, Sparkles, Undo2, X } from "lucide-react";
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
  SectionCard,
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
  status: "draft" | "review" | "published" | "archived";
  source: "ai" | "curated";
  learners: number;
  updated_at: string;
}

interface VocabularyPage {
  items: Word[];
  summary: { total: number; draft: number; published: number; by_level: Record<string, number> };
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
  generate: (input: { levels: string[]; count: number; theme?: string }) =>
    apiClient.post<{ job_id?: string; added?: Record<string, number> }>("/admin/vocabulary/generate", input),
  job: (id: string) => apiClient.get<JobState & { result?: { added?: Record<string, number>; failed?: string[] } }>(`/jobs/${id}`),
};

interface WordInput {
  term: string;
  part_of_speech: string;
  definition: string;
  examples: string[];
  pronunciation_ipa: string;
  level: CEFRLevel;
  tags: string[];
  translations: { uz: string; ru: string };
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
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Word | "new" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  // A generation keeps running if the page is left; coming back picks it up again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobId(readJob());
  }, []);

  const query = {
    q: search,
    level: level === "all" ? "" : level,
    status: status === "all" ? "" : status,
    page,
    page_size: PAGE_SIZE,
  };
  const list = useQuery({
    queryKey: ["owner", "vocabulary", query],
    queryFn: () => vocabularyApi.list(query),
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
      const added = Object.entries(job.data?.result?.added ?? {});
      const total = added.reduce((sum, [, n]) => sum + n, 0);
      const failed = job.data?.result?.failed ?? [];
      toast({
        title: `${total} new ${total === 1 ? "word" : "words"} written as drafts`,
        description:
          (added.length > 0 ? added.map(([code, n]) => `${code}: ${n}`).join(" · ") : "") +
          (failed.length > 0 ? ` — ${failed.join(", ")} could not be written, try again.` : " Read them, then publish."),
        variant: failed.length > 0 ? "default" : "success",
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

  const data = list.data?.data;
  const total = list.data?.meta?.total ?? 0;
  const summary = data?.summary;
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
    { key: "level", header: "Level", cell: (w) => (w.level ? <LevelBadge level={w.level} /> : "—"), width: "5rem" },
    {
      key: "meaning",
      header: "Meaning",
      hideBelow: "md",
      cell: (w) => (
        <div className="grid max-w-md gap-0.5">
          <span className="line-clamp-2 text-body-sm">{w.definition}</span>
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
        resultLabel={`${total} ${total === 1 ? "word" : "words"}`}
        onReset={() => {
          setSearch("");
          setLevel("all");
          setStatus("all");
          setPage(1);
        }}
      >
        <SearchInput
          label="Search words"
          placeholder="Search a word or its meaning"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          className="min-w-56 flex-1"
        />
        <FilterSelect
          label="Level"
          value={level}
          onChange={(v) => {
            setLevel(v);
            setPage(1);
          }}
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
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "Drafts and live" },
            { value: "draft", label: "Drafts" },
            { value: "published", label: "Live" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </FilterBar>

      <SectionCard title="Words" description="Drafts first, then by level" className="mt-4" bodyClassName="p-0">
        <DataTable
          caption="Vocabulary"
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(w) => w.id}
          isLoading={list.isPending}
          isError={list.isError}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(w) => setEditing(w)}
          empty={
            <div className="grid justify-items-center gap-3 py-10 text-center">
              <BookA className="size-8 text-fg-muted" aria-hidden />
              <p className="text-body-sm text-fg-secondary">No words here yet.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
                  <Plus aria-hidden /> Add one by hand
                </Button>
                <Button size="sm" disabled={busy} onClick={() => setGenerating(true)}>
                  <Sparkles aria-hidden /> Generate with AI
                </Button>
              </div>
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
      </SectionCard>

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
        byLevel={summary?.by_level ?? {}}
        onGenerate={(input) => {
          setGenerating(false);
          generate.mutate(input);
        }}
      />
    </>
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
  const [form, setForm] = useState<WordInput>({
    term: word?.term ?? "",
    part_of_speech: word?.part_of_speech ?? "noun",
    definition: word?.definition ?? "",
    examples: word?.examples.length ? word.examples : [""],
    pronunciation_ipa: word?.pronunciation_ipa ?? "",
    level: word?.level ?? "B1",
    tags: word?.tags ?? [],
    translations: { uz: word?.translations.uz ?? "", ru: word?.translations.ru ?? "" },
  });
  const set = (patch: Partial<WordInput>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const input = { ...form, examples: form.examples.filter((e) => e.trim()) };
      return word ? vocabularyApi.update(word.id, input) : vocabularyApi.create(input);
    },
    onSuccess: () => {
      toast({ title: word ? "Word saved" : "Word added as a draft", variant: "success" });
      onSaved();
    },
    onError: (error) =>
      toast({ title: "It could not be saved", description: isApiError(error) ? error.message : undefined, variant: "error" }),
  });
  const ready = form.term.trim().length > 0 && form.definition.trim().length > 1;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      className="sm:max-w-xl"
      title={word ? `Edit “${word.term}”` : "Add a word"}
      description={
        word
          ? "Changes to a live word reach learners straight away."
          : "It is saved as a draft; learners get it when you publish it."
      }
      confirmLabel={word ? "Save" : "Add word"}
      loading={save.isPending}
      disabled={!ready}
      onConfirm={() => save.mutate()}
    >
      <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_6rem]">
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
            <Label htmlFor="word-level">Level</Label>
            <NativeSelect id="word-level" value={form.level} onChange={(e) => set({ level: e.target.value as CEFRLevel })}>
              {cefrLevels.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="word-definition">Definition — in English the learner can read</Label>
          <Textarea id="word-definition" rows={2} value={form.definition} onChange={(e) => set({ definition: e.target.value })} />
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
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-label">Examples</legend>
          {form.examples.map((example, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Example ${i + 1}`}
                value={example}
                placeholder="A sentence somebody would actually say."
                onChange={(e) => set({ examples: form.examples.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove example ${i + 1}`}
                disabled={form.examples.length <= 1}
                onClick={() => set({ examples: form.examples.filter((_, j) => j !== i) })}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
          {form.examples.length < 5 && (
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => set({ examples: [...form.examples, ""] })}>
              <Plus aria-hidden /> Add an example
            </Button>
          )}
        </fieldset>
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

const countOptions = [10, 20, 30] as const;

/** One Generate writes a batch of new words for each level picked — every level by default. */
function GenerateWordsDialog({
  open,
  onOpenChange,
  byLevel,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  byLevel: Record<string, number>;
  onGenerate: (input: { levels: string[]; count: number; theme?: string }) => void;
}) {
  const [levels, setLevels] = useState<CEFRLevel[]>([...cefrLevels]);
  const [count, setCount] = useState<number>(20);
  const [theme, setTheme] = useState("");
  const toggle = (code: CEFRLevel) => setLevels(levels.includes(code) ? levels.filter((l) => l !== code) : [...levels, code]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      title="Generate vocabulary with AI"
      description="New words for each level you pick, never one already in the library. Each comes with a definition at its level, examples, pronunciation, and the word in Uzbek and Russian — as a draft for you to read."
      confirmLabel="Generate"
      disabled={levels.length === 0}
      onConfirm={() => onGenerate({ levels, count, theme: theme.trim() || undefined })}
      footerStart={levels.length === 0 ? "Pick at least one level" : `About ${levels.length * count} new words`}
    >
      <div className="grid gap-5">
        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label">Levels</h3>
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
                    "grid justify-items-center gap-0.5 rounded-lg border px-2 py-2 outline-none transition-colors duration-micro",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    on ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
                  )}
                >
                  <span className="text-body font-semibold">{code}</span>
                  <span className={cn("text-[0.6875rem]", on ? "opacity-80" : "text-fg-muted")}>
                    {byLevel[code] ?? 0} words
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="text-label">Words per level</h3>
          <div role="radiogroup" aria-label="Words per level" className="flex gap-2">
            {countOptions.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                onClick={() => setCount(n)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-body-sm font-medium outline-none transition-colors duration-micro",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  count === n ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
                )}
              >
                {count === n && <Check className="mr-1 inline size-3.5" aria-hidden />}
                {n}
              </button>
            ))}
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
          <p className="text-caption text-fg-muted">
            Uzbek and Russian translations, examples and pronunciation are always included.
          </p>
        </section>
      </div>
    </ConfirmDialog>
  );
}
