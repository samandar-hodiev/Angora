"use client";

import { Check, Eye, Minus, Pencil, Plus, Send, SpellCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { DataTable, Pagination, type Column } from "../components/data-table";
import {
  ActionMenu,
  ConfirmDialog,
  FilterBar,
  FilterSelect,
  LanguagePills,
  LevelBadge,
  OwnerPageHeader,
  SearchInput,
  SectionCard,
  StatusBadge,
} from "../components/primitives";
import { useGrammarCategories, useGrammarTopics, useUpdateContentStatus } from "../hooks";
import { formatDate, formatNumber, statusLabels } from "../lib/format";
import type { CEFRLevel, ContentStatus, GrammarTopicRow } from "../types";
import { cefrLevels, contentStatuses } from "../types";

const PAGE_SIZE = 20;

const statusOptions = [
  { value: "all" as const, label: "All statuses" },
  ...contentStatuses.map((status) => ({ value: status, label: statusLabels[status] })),
];

const levelOptions = [
  { value: "all" as const, label: "All levels" },
  ...cefrLevels.map((level) => ({ value: level, label: level })),
];

const languageOptions = [
  { value: "all" as const, label: "Any language" },
  { value: "uz" as const, label: "Published in UZ" },
  { value: "en" as const, label: "Published in EN" },
  { value: "ru" as const, label: "Published in RU" },
];

export function GrammarCmsView() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [level, setLevel] = useState<CEFRLevel | "all">("all");
  const [status, setStatus] = useState<ContentStatus | "all">("all");
  const [language, setLanguage] = useState<"all" | "uz" | "en" | "ru">("all");
  const [page, setPage] = useState(1);
  const [pendingPublish, setPendingPublish] = useState<GrammarTopicRow | null>(null);

  const categories = useGrammarCategories();
  const query = useMemo(
    () => ({ search, category, level, status, language, page, page_size: PAGE_SIZE }),
    [search, category, level, status, language, page],
  );
  const topics = useGrammarTopics(query);
  const updateStatus = useUpdateContentStatus();

  const categoryOptions = [
    { value: "all", label: "All categories" },
    ...(categories.data ?? []).map((entry) => ({ value: entry.slug, label: entry.name })),
  ];

  function resetFilters() {
    setSearch("");
    setCategory("all");
    setLevel("all");
    setStatus("all");
    setLanguage("all");
    setPage(1);
  }

  function selectCategory(slug: string) {
    setCategory((current) => (current === slug ? "all" : slug));
    setPage(1);
  }

  const columns: Column<GrammarTopicRow>[] = [
    {
      key: "topic",
      header: "Topic",
      width: "18rem",
      cell: (topic) => (
        <div className="grid min-w-0 gap-0.5">
          <Link href={`/owner/cms/grammar/${topic.slug}`} className="truncate font-medium hover:underline">
            {topic.name}
          </Link>
          <span className="truncate text-caption text-fg-muted">{topic.description}</span>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "md",
      cell: (topic) => <span className="text-fg-secondary">{topic.category_name}</span>,
    },
    { key: "level", header: "CEFR", cell: (topic) => <LevelBadge level={topic.level} /> },
    {
      key: "languages",
      header: "Languages",
      hideBelow: "lg",
      cell: (topic) => <LanguagePills languages={topic.languages} />,
    },
    { key: "status", header: "Status", cell: (topic) => <StatusBadge status={topic.status} /> },
    {
      key: "practice",
      header: "Practice",
      hideBelow: "lg",
      cell: (topic) =>
        topic.question_count > 0 ? (
          <span className="tabular-nums">{topic.question_count} questions</span>
        ) : (
          <span className="text-fg-muted">None</span>
        ),
    },
    {
      key: "visual",
      header: "Visual",
      hideBelow: "xl",
      cell: (topic) => <Availability available={topic.has_visual} />,
    },
    {
      key: "tutor",
      header: "AI tutor",
      hideBelow: "xl",
      cell: (topic) => <Availability available={topic.has_ai_tutor} />,
    },
    {
      key: "updated",
      header: "Updated",
      hideBelow: "md",
      cell: (topic) => <span className="text-fg-muted tabular-nums">{formatDate(topic.updated_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      srOnlyHeader: true,
      width: "3rem",
      cell: (topic) => (
        <ActionMenu
          label={`Actions for ${topic.name}`}
          items={[
            { label: "Edit lesson", icon: Pencil, href: `/owner/cms/grammar/${topic.slug}` },
            { label: "Preview as learner", icon: Eye, href: `/owner/cms/grammar/${topic.slug}?tab=preview` },
            {
              label: "Publish",
              icon: Send,
              separatorBefore: true,
              disabled: topic.status === "published",
              onSelect: () => setPendingPublish(topic),
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
        description="The 149 topics behind the learner grammar library, by category and status."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "CMS", href: "/owner/cms" }, { label: "Grammar" }]}
        actions={
          <Button size="sm" asChild>
            <Link href="/owner/cms/grammar/new">
              <Plus aria-hidden />
              Create grammar topic
            </Link>
          </Button>
        }
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
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {categories.data?.map((entry) => {
              const active = entry.slug === category;
              return (
                <li key={entry.slug}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectCategory(entry.slug)}
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

      <FilterBar onReset={resetFilters} resultLabel={topics.isPending ? undefined : `${formatNumber(total)} topics`}>
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
          options={categoryOptions}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="CEFR level"
          value={level}
          options={levelOptions}
          onChange={(value) => {
            setLevel(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={statusOptions}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Language"
          value={language}
          options={languageOptions}
          onChange={(value) => {
            setLanguage(value);
            setPage(1);
          }}
        />
      </FilterBar>

      <SectionCard title="Topics" description="Grammar lessons and their editorial state" bodyClassName="p-0">
        <DataTable
          caption="Grammar topics"
          columns={columns}
          rows={topics.data?.items ?? []}
          rowKey={(topic) => topic.id}
          isLoading={topics.isPending}
          isError={topics.isError}
          error={topics.error}
          onRetry={() => void topics.refetch()}
          minWidth="68rem"
          empty={
            <EmptyState
              icon={SpellCheck}
              title="No grammar topics found"
              description="Nothing matches these filters. Clear them, or create the topic you were looking for."
              action={
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              }
            />
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
      </SectionCard>

      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(open) => !open && setPendingPublish(null)}
        title={pendingPublish ? `Publish "${pendingPublish.name}"?` : ""}
        description="This will make the content available to learners."
        confirmLabel="Publish"
        loading={updateStatus.isPending}
        onConfirm={() => {
          if (!pendingPublish) return;
          updateStatus.mutate(
            { id: pendingPublish.id, status: "published" },
            {
              onSuccess: () =>
                toast({ title: `"${pendingPublish.name}" published`, description: "Learners can open it now.", variant: "success" }),
            },
          );
          setPendingPublish(null);
        }}
      />
    </>
  );
}

function Availability({ available }: { available: boolean }) {
  return available ? (
    <span className="inline-flex items-center gap-1 text-success">
      <Check className="size-3.5" aria-hidden />
      Available
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-fg-muted">
      <Minus className="size-3.5" aria-hidden />
      None
    </span>
  );
}
