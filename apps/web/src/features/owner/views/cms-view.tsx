"use client";

import { Archive, Eye, FileStack, Pencil, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";

import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import {
  ActionMenu,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  KeyValue,
  LevelBadge,
  OwnerPageHeader,
  SearchInput,
  SectionCard,
} from "../components/primitives";
import {
  useContentDetail,
  useContentVersions,
  useRestoreContentVersion,
  useContentTaxonomy,
  useLiveContent,
  useSaveContent,
  useSetContentStatus,
} from "../hooks";
import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import type { LiveContentRow } from "../types";

/**
 * Content management, on the content_items table the learner app reads.
 *
 * Publishing here is what puts something in front of learners, which is why it is the one
 * action that asks first — and why the API refuses to publish a reading or listening set
 * that has no questions to answer.
 */

const PAGE_SIZE = 25;

const statusStyles: Record<string, string> = {
  draft: "border-transparent bg-surface-active text-fg-secondary",
  review: "border-transparent bg-warning/20 text-warning-foreground",
  published: "border-transparent bg-success/15 text-success",
  archived: "border-transparent bg-surface-active text-fg-muted line-through",
};

export function OwnerCmsView() {
  const router = useRouter();
  const params = useSearchParams();

  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState(params.get("type") ?? "all");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [pending, setPending] = useState<{ row: LiveContentRow; status: string } | null>(null);

  const query = useMemo(() => ({ search, skill, level, status, page }), [search, skill, level, status, page]);
  const content = useLiveContent(query);
  const taxonomy = useContentTaxonomy();
  const setStatusMutation = useSetContentStatus();

  function reset() {
    setSearch("");
    setSkill("all");
    setLevel("all");
    setStatus("all");
    setPage(1);
    router.replace("/owner/cms");
  }

  function applyStatus(row: LiveContentRow, next: string) {
    setStatusMutation.mutate(
      { id: row.id, status: next },
      {
        onSuccess: () =>
          toast({
            title: next === "published" ? `"${row.title}" published` : `"${row.title}" ${next}`,
            description: next === "published" ? "Learners can open it now." : undefined,
            variant: "success",
          }),
        onError: (error) =>
          toast({
            title: "That change was refused",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
      },
    );
    setPending(null);
  }

  const columns: Column<LiveContentRow>[] = [
    {
      key: "title",
      header: "Content",
      width: "22rem",
      cell: (row) => (
        <div className="grid min-w-0 gap-0.5">
          <button type="button" onClick={() => setEditing({ id: row.id })} className="truncate text-left font-medium hover:underline">
            {row.title}
          </button>
          <span className="truncate text-caption text-fg-muted">{row.type.replace(/_/g, " ")}</span>
        </div>
      ),
    },
    { key: "skill", header: "Skill", hideBelow: "sm", cell: (row) => <span className="text-fg-secondary capitalize">{row.skill ?? "—"}</span> },
    {
      key: "level",
      header: "Level",
      hideBelow: "md",
      cell: (row) => (row.level ? <LevelBadge level={row.level} /> : <span className="text-fg-muted">—</span>),
    },
    {
      key: "topic",
      header: "Topic",
      hideBelow: "xl",
      cell: (row) => <span className="text-fg-muted">{row.topic ?? "—"}</span>,
    },
    { key: "status", header: "Status", cell: (row) => <Badge className={statusStyles[row.status]}>{row.status}</Badge> },
    {
      key: "updated",
      header: "Updated",
      hideBelow: "lg",
      cell: (row) => <span className="text-fg-muted tabular-nums">{formatDate(row.updated_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      srOnlyHeader: true,
      width: "3rem",
      cell: (row) => (
        <ActionMenu
          label={`Actions for ${row.title}`}
          items={[
            { label: "Edit", icon: Pencil, onSelect: () => setEditing({ id: row.id }) },
            ...(row.skill === "reading" || row.skill === "listening"
              ? [{ label: "Questions", icon: Eye, href: `/owner/questions?search=${encodeURIComponent(row.title)}` }]
              : []),
            {
              label: "Publish",
              icon: Send,
              separatorBefore: true,
              disabled: row.status === "published",
              onSelect: () => setPending({ row, status: "published" }),
            },
            {
              label: "Archive",
              icon: Archive,
              destructive: true,
              disabled: row.status === "archived",
              onSelect: () => setPending({ row, status: "archived" }),
            },
          ]}
        />
      ),
    },
  ];

  const total = content.data?.total ?? 0;

  return (
    <>
      <OwnerPageHeader
        title="Content"
        description="Everything learners can open, on the table the learner app reads."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Content" }]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/owner/cms/grammar">Grammar</Link>
            </Button>
            <Button size="sm" onClick={() => setEditing({ id: null })}>
              <Plus aria-hidden />
              New content
            </Button>
          </>
        }
      />

      <FilterBar onReset={reset} resultLabel={content.isPending ? undefined : `${formatNumber(total)} items`}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search content"
          placeholder="Search by title"
        />
        <FilterSelect
          label="Skill"
          value={skill}
          options={[
            { value: "all", label: "All skills" },
            ...(taxonomy.data?.skills ?? []).map((s) => ({ value: s.code, label: s.name })),
          ]}
          onChange={(value) => {
            setSkill(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Level"
          value={level}
          options={[
            { value: "all", label: "All levels" },
            ...(taxonomy.data?.levels ?? []).map((l) => ({ value: l.code, label: l.code })),
          ]}
          onChange={(value) => {
            setLevel(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "review", label: "Review" },
            { value: "published", label: "Published" },
            { value: "archived", label: "Archived" },
          ]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      </FilterBar>

      <SectionCard title="All content" description="Live from the platform database" bodyClassName="p-0">
        {content.isError ? (
          <div className="p-4">
            <LiveDataState error={content.error} onRetry={() => void content.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              caption="Learner-facing content"
              columns={columns}
              rows={content.data?.items ?? []}
              rowKey={(row) => row.id}
              isLoading={content.isPending}
              minWidth="60rem"
              empty={
                <div className="grid justify-items-center gap-3 py-6 text-center">
                  <FileStack className="size-8 text-fg-muted" aria-hidden />
                  <p className="text-h4">No content matches these filters</p>
                  <Button variant="outline" size="sm" onClick={reset}>
                    Clear filters
                  </Button>
                </div>
              }
            />
            <Pagination
              page={content.data?.page ?? 1}
              totalPages={content.data?.total_pages ?? 1}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              label="items"
            />
          </>
        )}
      </SectionCard>

      {editing && <ContentEditor id={editing.id} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.status === "published" ? `Publish "${pending?.row.title}"?` : `Archive "${pending?.row.title}"?`}
        description={
          pending?.status === "published"
            ? "Learners can open this from their next visit."
            : "It stops being offered to learners. Nothing already recorded is affected."
        }
        confirmLabel={pending?.status === "published" ? "Publish" : "Archive"}
        destructive={pending?.status === "archived"}
        loading={setStatusMutation.isPending}
        onConfirm={() => pending && applyStatus(pending.row, pending.status)}
      />
    </>
  );
}

function ContentEditor({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useContentDetail(id);
  const taxonomy = useContentTaxonomy();
  const save = useSaveContent();

  const [loaded, setLoaded] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    type: "reading_passage",
    skill: "reading",
    level: "B1",
    difficulty: 5,
    body: "{}",
    note: "",
  });

  // Fill the form the first time the record arrives.
  if (detail.data && loaded !== detail.data.id) {
    setLoaded(detail.data.id);
    setForm({
      title: detail.data.title,
      type: detail.data.type,
      skill: detail.data.skill ?? "reading",
      level: detail.data.level ?? "B1",
      difficulty: detail.data.difficulty,
      body: JSON.stringify(detail.data.body ?? {}, null, 2),
      note: "",
    });
  }

  let bodyError: string | null = null;
  try {
    JSON.parse(form.body || "{}");
  } catch {
    bodyError = "The body must be valid JSON.";
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{id ? "Edit content" : "New content"}</DialogTitle>
          <DialogDescription>
            {id
              ? "Changes take effect as soon as they are saved. Publishing is separate."
              : "Content is created as a draft. Publish when it is ready."}
          </DialogDescription>
        </DialogHeader>

        {id && detail.isError ? (
          <LiveDataState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="content-title">Title</Label>
              <Input id="content-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="content-type">Type</Label>
                <Input id="content-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="content-skill">Skill</Label>
                <NativeSelect id="content-skill" value={form.skill} onChange={(e) => setForm({ ...form, skill: e.target.value })}>
                  {(taxonomy.data?.skills ?? []).map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="content-level">Level</Label>
                <NativeSelect id="content-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                  {(taxonomy.data?.levels ?? []).map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.code}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="content-difficulty">Difficulty (1–10)</Label>
                <Input
                  id="content-difficulty"
                  type="number"
                  min={1}
                  max={10}
                  value={form.difficulty}
                  onChange={(e) => setForm({ ...form, difficulty: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="content-body">Body (JSON)</Label>
              <Textarea
                id="content-body"
                rows={10}
                className="font-mono text-caption"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                aria-invalid={bodyError !== null}
              />
              <p className={bodyError ? "text-caption text-error" : "text-caption text-fg-muted"}>
                {bodyError ?? "The passage, transcript or task prompt, as the learner app expects it."}
              </p>
            </div>

            {id && (
              <div className="grid gap-1.5">
                <Label htmlFor="content-note">What changed?</Label>
                <Input
                  id="content-note"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Shortened paragraph 3 — learners were timing out"
                  maxLength={300}
                />
                <p className="text-caption text-fg-muted">
                  Optional, and stored with the revision. A diff can show what changed; only you can say why.
                </p>
              </div>
            )}

            {detail.data && (
              <dl className="grid">
                <KeyValue label="Questions">{detail.data.question_count}</KeyValue>
                <KeyValue label="Status">{detail.data.status}</KeyValue>
                <KeyValue label="Revision">{detail.data.version}</KeyValue>
              </dl>
            )}

            {id && <RevisionHistory id={id} currentVersion={detail.data?.version ?? 1} />}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={bodyError !== null || form.title.trim().length < 2}
            onClick={() =>
              save.mutate(
                {
                  id: id ?? undefined,
                  input: {
                    title: form.title.trim(),
                    type: form.type,
                    skill: form.skill,
                    level: form.level,
                    difficulty: form.difficulty,
                    body: JSON.parse(form.body || "{}"),
                    note: form.note.trim() || undefined,
                  },
                },
                {
                  onSuccess: () => {
                    toast({ title: id ? "Content saved" : "Content created", variant: "success" });
                    onClose();
                  },
                  onError: (error) =>
                    toast({
                      title: "It could not be saved",
                      description: isApiError(error) ? error.message : undefined,
                      variant: "error",
                    }),
                },
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What this item used to say.
 *
 * Restoring never rewinds: bringing version 3 back produces a new version with version 3's
 * text, so the history still shows that a restore happened and what it replaced. That is
 * the entire reason for keeping a history — a log you can edit is not a log.
 */
function RevisionHistory({ id, currentVersion }: { id: string; currentVersion: number }) {
  const versions = useContentVersions(id);
  const restore = useRestoreContentVersion();
  const [confirming, setConfirming] = useState<number | null>(null);

  if (versions.isError) {
    return <LiveDataState error={versions.error} onRetry={() => void versions.refetch()} />;
  }

  return (
    <section className="grid gap-2 rounded-lg border p-3" aria-labelledby="revision-history">
      <h3 id="revision-history" className="text-label text-fg-muted">
        Revision history
      </h3>
      {versions.isPending ? (
        <Skeleton className="h-20" />
      ) : (versions.data ?? []).length <= 1 ? (
        <p className="text-caption text-fg-muted">This item has not been edited since it was created.</p>
      ) : (
        <ul className="grid gap-1">
          {(versions.data ?? []).map((version) => (
            <li key={version.version} className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover">
              <span className="grid min-w-0 gap-0.5">
                <span className="flex items-center gap-2 text-body-sm">
                  <span className="tabular-nums">v{version.version}</span>
                  <span className="truncate text-fg-secondary">{version.title}</span>
                  {version.is_current && <Badge variant="outline">current</Badge>}
                </span>
                <span className="truncate text-caption text-fg-muted">
                  {formatDateTime(version.created_at)}
                  {version.author ? ` · ${version.author}` : ""}
                  {version.note ? ` · ${version.note}` : ""}
                </span>
              </span>
              {!version.is_current && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setConfirming(version.version)}
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Restore version ${confirming ?? ""}?`}
        description={`The current text becomes version ${currentVersion + 1} of the history, and version ${confirming ?? ""}'s text goes live. Nothing is deleted.`}
        confirmLabel="Restore"
        loading={restore.isPending}
        onConfirm={() => {
          if (confirming === null) return;
          restore.mutate(
            { id, version: confirming },
            {
              onSuccess: () => {
                toast({ title: `Version ${confirming} restored`, variant: "success" });
                setConfirming(null);
              },
              onError: (error) =>
                toast({
                  title: "It could not be restored",
                  description: isApiError(error) ? error.message : undefined,
                  variant: "error",
                }),
            },
          );
        }}
      />
    </section>
  );
}
