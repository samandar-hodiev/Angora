"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, Send, Shuffle, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";

import { Highlight } from "@/components/common/highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { apiClient, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { DataTable, type Column } from "../components/data-table";
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
import type { CEFRLevel } from "../types";

/**
 * Irregular verbs, as the owner manages them: the curated table, extended by hand or with
 * the AI — every suggestion checked to really be irregular and not already in the table —
 * edited, and published. Learners see published verbs only; their page does not change.
 */

type Pattern = "AAA" | "ABB" | "ABA" | "ABC";
type Status = "draft" | "published" | "archived";

interface Verb {
  id: string;
  base: string;
  past: string;
  past_participle: string;
  pattern: Pattern;
  level: CEFRLevel;
  uz: string;
  ru: string;
  note: string;
  examples: { base?: string; past?: string; participle?: string };
  status: Status;
  source: "curated" | "ai";
  learners: number;
}

interface VerbPage {
  items: Verb[];
  summary: { total: number; draft: number; published: number };
}

interface VerbInput {
  base: string;
  past: string;
  past_participle: string;
  level: CEFRLevel;
  uz: string;
  ru: string;
  note: string;
  examples: { base: string; past: string; participle: string };
}

const PATTERN_EXAMPLE: Record<Pattern, string> = {
  ABC: "go – went – gone",
  ABB: "buy – bought – bought",
  ABA: "come – came – come",
  AAA: "cut – cut – cut",
};

const verbsApi = {
  list: (query: Record<string, string>) => apiClient.get<VerbPage>("/admin/irregular-verbs", { query }),
  create: (input: VerbInput) => apiClient.post<Verb>("/admin/irregular-verbs", input),
  update: (id: string, input: VerbInput) => apiClient.patch<Verb>(`/admin/irregular-verbs/${id}`, input),
  status: (id: string, status: Status) => apiClient.post<Verb>(`/admin/irregular-verbs/${id}/status`, { status }),
  publish: (ids?: string[]) => apiClient.post<{ published: number }>("/admin/irregular-verbs/publish", { ids }),
  generate: (input: { count: number; min_level?: string; max_level?: string }) =>
    apiClient.post<{ added: number; requested: number }>("/admin/irregular-verbs/generate", input),
};

export function IrregularVerbsView() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<"all" | CEFRLevel>("all");
  const [pattern, setPattern] = useState<"all" | Pattern>("all");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [editing, setEditing] = useState<Verb | "new" | null>(null);
  const [generating, setGenerating] = useState(false);

  const query = {
    q: search,
    level: level === "all" ? "" : level,
    pattern: pattern === "all" ? "" : pattern,
    status: status === "all" ? "" : status,
  };
  const list = useQuery({
    queryKey: ["owner", "irregular-verbs", query],
    queryFn: () => verbsApi.list(query),
    placeholderData: (previous) => previous,
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ["owner", "irregular-verbs"] });
  const summary = list.data?.summary;

  const setVerbStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => verbsApi.status(id, status),
    onSuccess: refresh,
  });
  const publishAll = useMutation({
    mutationFn: () => verbsApi.publish(),
    onSuccess: (r) => {
      toast({ title: `${r.published} ${r.published === 1 ? "verb is" : "verbs are"} live`, variant: "success" });
      refresh();
    },
  });
  const generate = useMutation({
    mutationFn: verbsApi.generate,
    onSuccess: (r) => {
      toast({
        title: `${r.added} new ${r.added === 1 ? "verb" : "verbs"} added as drafts`,
        description: "Each was checked to be irregular and new to the table. Read them, then publish.",
        variant: "success",
      });
      setStatus("draft");
      refresh();
    },
    onError: (error) =>
      toast({ title: "Generation failed", description: isApiError(error) ? error.message : undefined, variant: "error" }),
  });

  const columns: Column<Verb>[] = [
    {
      key: "base",
      header: "Verb",
      cell: (v) => (
        <div className="grid gap-0.5">
          <span className="font-semibold">
            <Highlight text={v.base} query={search} />
          </span>
          <span className="text-caption text-fg-muted">{PATTERN_EXAMPLE[v.pattern]}</span>
        </div>
      ),
    },
    { key: "past", header: "Past Simple", cell: (v) => <Highlight text={v.past} query={search} /> },
    { key: "pp", header: "Past Participle", cell: (v) => <Highlight text={v.past_participle} query={search} /> },
    { key: "level", header: "Level", width: "5rem", cell: (v) => <LevelBadge level={v.level} /> },
    {
      key: "meaning",
      header: "Uzbek · Russian",
      hideBelow: "md",
      cell: (v) => <span className="text-body-sm text-fg-secondary">{[v.uz, v.ru].filter(Boolean).join(" · ") || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "9rem",
      cell: (v) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={v.status} />
          {v.source === "ai" && v.status !== "published" && <Badge variant="outline">AI</Badge>}
        </span>
      ),
    },
    { key: "learners", header: "Practised", hideBelow: "lg", align: "right", width: "6rem", cell: (v) => v.learners },
    {
      key: "actions",
      header: "Actions",
      srOnlyHeader: true,
      align: "right",
      width: "4rem",
      cell: (v) => (
        <ActionMenu
          label={`Actions for ${v.base}`}
          items={[
            { label: "Edit", icon: Pencil, onSelect: () => setEditing(v) },
            v.status === "published"
              ? { label: "Unpublish", icon: Undo2, onSelect: () => setVerbStatus.mutate({ id: v.id, status: "draft" }) }
              : { label: "Publish", icon: Send, onSelect: () => setVerbStatus.mutate({ id: v.id, status: "published" }) },
            {
              label: v.status === "archived" ? "Restore as draft" : "Archive",
              icon: Archive,
              separatorBefore: true,
              destructive: v.status !== "archived",
              onSelect: () => setVerbStatus.mutate({ id: v.id, status: v.status === "archived" ? "draft" : "archived" }),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <OwnerPageHeader
        title="Irregular verbs"
        description="The table learners study and practise. Add a verb by hand or let the AI suggest more — each is checked to be irregular and new — then publish."
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Content CMS", href: "/owner/content" },
          { label: "Lexicon" },
          { label: "Irregular verbs" },
        ]}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add verb
            </Button>
            <Button variant="outline" loading={generate.isPending} onClick={() => setGenerating(true)}>
              <Sparkles aria-hidden /> Generate with AI
            </Button>
            <Button
              disabled={!summary || summary.draft === 0 || publishAll.isPending}
              loading={publishAll.isPending}
              onClick={() => publishAll.mutate()}
            >
              <Send aria-hidden /> Publish all drafts{summary && summary.draft > 0 ? ` (${summary.draft})` : ""}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Tile label="In the table" value={summary?.total} />
        <Tile label="Waiting to publish" value={summary?.draft} tone={summary && summary.draft > 0 ? "warning" : undefined} />
        <Tile label="Live for learners" value={summary?.published} tone="success" />
      </div>

      <FilterBar
        resultLabel={list.data ? `${list.data.items.length} verbs` : undefined}
        onReset={() => {
          setSearch("");
          setLevel("all");
          setPattern("all");
          setStatus("all");
        }}
      >
        <SearchInput
          label="Search verbs"
          placeholder="Search any form or meaning"
          value={search}
          onChange={setSearch}
          className="min-w-56 flex-1"
        />
        <FilterSelect
          label="Level"
          value={level}
          onChange={setLevel}
          options={[{ value: "all", label: "All levels" }, ...cefrLevels.map((c) => ({ value: c, label: c }))]}
        />
        <FilterSelect
          label="Pattern"
          value={pattern}
          onChange={setPattern}
          options={[
            { value: "all", label: "Every pattern" },
            ...(Object.keys(PATTERN_EXAMPLE) as Pattern[]).map((p) => ({ value: p, label: PATTERN_EXAMPLE[p] })),
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

      <div className="mt-4 overflow-hidden rounded-xl border bg-surface">
        <DataTable
          caption="Irregular verbs"
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(v) => v.id}
          isLoading={list.isPending}
          isError={list.isError}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={setEditing}
          empty={
            <div className="grid justify-items-center gap-2 py-8 text-center">
              <Shuffle className="size-7 text-fg-muted" aria-hidden />
              <p className="text-body-sm text-fg-secondary">No verbs match.</p>
            </div>
          }
        />
      </div>

      {editing && (
        <VerbDialog
          verb={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      <GenerateVerbsDialog
        key={generating ? "open" : "closed"}
        open={generating}
        onOpenChange={setGenerating}
        onGenerate={(input) => {
          setGenerating(false);
          generate.mutate(input);
        }}
      />
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value?: number; tone?: "warning" | "success" }) {
  return (
    <div className="grid gap-0.5 rounded-xl border bg-surface px-4 py-3">
      <span className="text-caption text-fg-muted">{label}</span>
      <span className="text-h3 tabular-nums">
        <span className={cn(tone === "warning" && "text-warning-text", tone === "success" && "text-success")}>
          {value ?? "—"}
        </span>
      </span>
    </div>
  );
}

/** Add or edit one verb. Two accepted spellings go in one field: "learnt / learned". */
function VerbDialog({ verb, onClose, onSaved }: { verb: Verb | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<VerbInput>(() => ({
    base: verb?.base ?? "",
    past: verb?.past ?? "",
    past_participle: verb?.past_participle ?? "",
    level: verb?.level ?? "B1",
    uz: verb?.uz ?? "",
    ru: verb?.ru ?? "",
    note: verb?.note ?? "",
    examples: { base: verb?.examples.base ?? "", past: verb?.examples.past ?? "", participle: verb?.examples.participle ?? "" },
  }));
  const set = (patch: Partial<VerbInput>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: () => (verb ? verbsApi.update(verb.id, form) : verbsApi.create(form)),
    onSuccess: onSaved,
  });
  const valid = form.base.trim() && form.past.trim() && form.past_participle.trim();
  const field = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      className="sm:max-w-2xl"
      title={verb ? `Edit “${verb.base}”` : "Add an irregular verb"}
      description="A new verb is saved as a draft; publish it when it is right. A regular verb (worked, liked) is refused."
      confirmLabel={verb ? "Save" : "Add as draft"}
      loading={save.isPending}
      disabled={!valid}
      onConfirm={() => save.mutate()}
      footerStart={
        save.isError ? (
          <span className="text-error">{isApiError(save.error) ? save.error.message : "Could not save"}</span>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {field("verb-base", "Base form", form.base, (base) => set({ base }), "go")}
          {field("verb-past", "Past Simple", form.past, (past) => set({ past }), "went")}
          {field("verb-pp", "Past Participle", form.past_participle, (past_participle) => set({ past_participle }), "gone")}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="verb-level">Level</Label>
            <NativeSelect id="verb-level" value={form.level} onChange={(e) => set({ level: e.target.value as CEFRLevel })}>
              {cefrLevels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          {field("verb-uz", "Uzbek", form.uz, (uz) => set({ uz }), "bormoq")}
          {field("verb-ru", "Russian", form.ru, (ru) => set({ ru }), "идти")}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="verb-note">Note for learners (Uzbek) — what trips them up</Label>
          <Textarea id="verb-note" rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <p className="text-label">Example sentences</p>
          {(["base", "past", "participle"] as const).map((k) => (
            <Input
              key={k}
              aria-label={`Example with the ${k} form`}
              placeholder={k === "base" ? "With the base form" : k === "past" ? "In the past simple" : "In the present perfect"}
              value={form.examples[k]}
              onChange={(e) => set({ examples: { ...form.examples, [k]: e.target.value } })}
            />
          ))}
        </div>
      </div>
    </ConfirmDialog>
  );
}

function GenerateVerbsDialog({
  open,
  onOpenChange,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (input: { count: number; min_level?: string; max_level?: string }) => void;
}) {
  const [count, setCount] = useState(15);
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Suggest irregular verbs with AI"
      description="Verbs not yet in the table, with their forms, level, Uzbek and Russian, a note and example sentences — as drafts for you to read. A suggestion that is really a regular verb, or already in the table, is dropped."
      confirmLabel="Generate"
      onConfirm={() => onGenerate({ count, min_level: minLevel || undefined, max_level: maxLevel || undefined })}
      footerStart={`${count} new verbs`}
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label>How many</Label>
          <div className="flex flex-wrap gap-2">
            {[10, 15, 25, 40].map((n) => (
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
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Level range — optional</Label>
          <div className="flex flex-wrap items-center gap-2 text-body-sm">
            <NativeSelect value={minLevel} onChange={(e) => setMinLevel(e.target.value)} aria-label="Lowest level">
              <option value="">Any</option>
              {cefrLevels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <span className="text-fg-muted">to</span>
            <NativeSelect value={maxLevel} onChange={(e) => setMaxLevel(e.target.value)} aria-label="Highest level">
              <option value="">Any</option>
              {cefrLevels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>
    </ConfirmDialog>
  );
}
