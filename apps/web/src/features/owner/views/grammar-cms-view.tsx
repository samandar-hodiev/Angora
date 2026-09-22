"use client";

import { Check, Eye, Minus, Pencil, Send, SpellCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import {
  ActionMenu,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  LevelBadge,
  OwnerPageHeader,
  SearchInput,
  SectionCard,
} from "../components/primitives";
import { useGrammarAdminCategories, useGrammarAdminTopics, useSetGrammarTopicStatus } from "../hooks";
import { formatDate, formatNumber } from "../lib/format";
import type { LiveGrammarTopicRow } from "../types";
import { cefrLevels } from "../types";

/**
 * Grammar authoring, on the topics the learner app serves.
 *
 * A topic and its explanation publish together: the API refuses to publish a topic whose
 * explanation is still a draft, because a catalogue entry that opens onto nothing is worse
 * than one that is not there yet.
 */

const PAGE_SIZE = 25;

const statusStyles: Record<string, string> = {
  draft: "border-transparent bg-surface-active text-fg-secondary",
  review: "border-transparent bg-warning/20 text-warning-foreground",
  published: "border-transparent bg-success/15 text-success",
  archived: "border-transparent bg-surface-active text-fg-muted line-through",
};

export function GrammarCmsView() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ row: LiveGrammarTopicRow; status: string } | null>(null);

  const categories = useGrammarAdminCategories();
  const query = useMemo(() => ({ search, category, level, status, page }), [search, category, level, status, page]);
  const topics = useGrammarAdminTopics(query);
  const setStatusMutation = useSetGrammarTopicStatus();

  function reset() {
    setSearch("");
    setCategory("all");
    setLevel("all");
    setStatus("all");
    setPage(1);
  }

  const columns: Column<LiveGrammarTopicRow>[] = [
    {
      key: "topic",
      header: "Topic",
      width: "20rem",
      cell: (row) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/owner/cms/grammar/${row.slug}`} className="truncate font-medium hover:underline">
            {row.name}
          </Link>
          <span className="truncate text-caption text-fg-muted">{row.description}</span>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "md",
      cell: (row) => <span className="text-fg-secondary">{row.category_name ?? "—"}</span>,
    },
    {
      key: "level",
      header: "CEFR",
      cell: (row) => (row.level ? <LevelBadge level={row.level} /> : <span className="text-fg-muted">—</span>),
    },
    {
      key: "content",
      header: "Explanation",
      hideBelow: "lg",
      cell: (row) =>
        row.has_content ? (
          <span className={cn("inline-flex items-center gap-1", row.content_status === "published" ? "text-success" : "text-warning-foreground")}>
            <Check className="size-3.5" aria-hidden />
            {row.content_status}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <Minus className="size-3.5" aria-hidden />
            None
          </span>
        ),
    },
    {
      key: "languages",
      header: "Languages",
      hideBelow: "xl",
      // Which translations a learner can actually get. A topic published only in English is
      // not broken — it is simply not translated yet, and that is what this column says.
      cell: (row) =>
        row.languages.length === 0 ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.languages.map((code) => (
              <Badge key={code} variant="outline" className="uppercase">
                {code}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: "practice",
      header: "Practice",
      hideBelow: "xl",
      cell: (row) =>
        row.question_count > 0 ? (
          <span className="tabular-nums">{row.question_count} questions</span>
        ) : (
          <span className="text-fg-muted">None</span>
        ),
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
          label={`Actions for ${row.name}`}
          items={[
            { label: "Edit lesson", icon: Pencil, href: `/owner/cms/grammar/${row.slug}` },
            { label: "Preview as learner", icon: Eye, href: `/owner/cms/grammar/${row.slug}?tab=preview` },
            {
              label: "Publish",
              icon: Send,
              separatorBefore: true,
              disabled: row.status === "published",
              onSelect: () => setPending({ row, status: "published" }),
            },
          ]}
        />
      ),
    },
  ];

  const total = topics.data?.total ?? 0;

  return (
    <>
      <OwnerPageHeader
        title="Grammar"
        description="The topics behind the learner grammar library, with their explanations and practice."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Content CMS", href: "/owner/content" }, { label: "Grammar" }]}
      />

      <SectionCard
        title="Categories"
        description="Select one to filter the table"
        className="mb-5"
        action={
          category !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setCategory("all")}>
              Clear
            </Button>
          )
        }
      >
        {categories.isPending ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : categories.isError ? (
          <LiveDataState error={categories.error} onRetry={() => void categories.refetch()} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {categories.data?.map((entry) => {
              const active = entry.slug === category;
              return (
                <li key={entry.slug}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setCategory(active ? "all" : entry.slug);
                      setPage(1);
                    }}
                    className={cn(
                      "grid w-full gap-1 rounded-lg border bg-surface p-3 text-left transition-colors duration-micro",
                      "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      active ? "border-primary bg-primary-subtle" : "hover:border-primary/40 hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-body-sm font-medium">{entry.name}</span>
                      <span className="shrink-0 text-caption text-fg-muted tabular-nums">{entry.topics}</span>
                    </span>
                    <span className="text-caption text-fg-muted tabular-nums">
                      {entry.published} published
                      {entry.review > 0 && ` · ${entry.review} review`}
                      {entry.draft > 0 && ` · ${entry.draft} draft`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <FilterBar onReset={reset} resultLabel={topics.isPending ? undefined : `${formatNumber(total)} topics`}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search grammar topics"
          placeholder="Search topics"
        />
        <FilterSelect
          label="Category"
          value={category}
          options={[{ value: "all", label: "All categories" }, ...(categories.data ?? []).map((c) => ({ value: c.slug, label: c.name }))]}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Level"
          value={level}
          options={[{ value: "all", label: "All levels" }, ...cefrLevels.map((l) => ({ value: l, label: l }))]}
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

      <SectionCard title="Topics" description="Live from the platform database" bodyClassName="p-0">
        {topics.isError ? (
          <div className="p-4">
            <LiveDataState error={topics.error} onRetry={() => void topics.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              caption="Grammar topics"
              columns={columns}
              rows={topics.data?.items ?? []}
              rowKey={(row) => row.id}
              isLoading={topics.isPending}
              minWidth="64rem"
              empty={
                <div className="grid justify-items-center gap-3 py-6 text-center">
                  <SpellCheck className="size-8 text-fg-muted" aria-hidden />
                  <p className="text-h4">No topics match these filters</p>
                  <Button variant="outline" size="sm" onClick={reset}>
                    Clear filters
                  </Button>
                </div>
              }
            />
            <Pagination
              page={topics.data?.page ?? 1}
              totalPages={topics.data?.total_pages ?? 1}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              label="topics"
            />
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending ? `Publish "${pending.row.name}"?` : ""}
        description="The topic and its latest explanation go live together. Learners see it from their next visit."
        confirmLabel="Publish"
        loading={setStatusMutation.isPending}
        onConfirm={() => {
          if (!pending) return;
          setStatusMutation.mutate(
            { slug: pending.row.slug, status: pending.status },
            {
              onSuccess: () => toast({ title: `"${pending.row.name}" published`, variant: "success" }),
              onError: (error) =>
                toast({
                  title: "That change was refused",
                  description: isApiError(error) ? error.message : undefined,
                  variant: "error",
                }),
            },
          );
          setPending(null);
        }}
      />
    </>
  );
}
