"use client";

import { Archive, Eye, FileStack, Pencil, Send, SpellCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

import { DataTable, Pagination, type Column } from "../components/data-table";
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
  StatCardSkeleton,
  StatusBadge,
} from "../components/primitives";
import { useContent, useContentStats, useUpdateContentStatus } from "../hooks";
import { formatDate, formatNumber, languageLabels, skillLabels, statusLabels } from "../lib/format";
import type { CEFRLevel, ContentItem, ContentLanguage, ContentStatus, SkillKey } from "../types";
import { cefrLevels, contentStatuses, skillKeys } from "../types";

const PAGE_SIZE = 20;

const typeOptions = [
  { value: "all" as const, label: "All types" },
  ...skillKeys.map((skill) => ({ value: skill, label: skillLabels[skill] })),
];

const statusOptions = [
  { value: "all" as const, label: "All statuses" },
  ...contentStatuses.map((status) => ({ value: status, label: statusLabels[status] })),
];

const levelOptions = [
  { value: "all" as const, label: "All levels" },
  ...cefrLevels.map((level) => ({ value: level, label: level })),
];

const languageOptions = [
  { value: "all" as const, label: "All languages" },
  { value: "uz" as const, label: "Uzbek" },
  { value: "en" as const, label: "English" },
  { value: "ru" as const, label: "Russian" },
];

const sourceOptions = [
  { value: "all" as const, label: "Any source" },
  { value: "curated" as const, label: "Curated" },
  { value: "ai" as const, label: "AI generated" },
  { value: "imported" as const, label: "Imported" },
];

const sortOptions = [
  { value: "updated" as const, label: "Last updated" },
  { value: "title" as const, label: "Title A–Z" },
  { value: "status" as const, label: "Status" },
];

export function OwnerCmsView() {
  const router = useRouter();
  const params = useSearchParams();
  const initialType = (params.get("type") as SkillKey | null) ?? "all";

  const [search, setSearch] = useState("");
  const [type, setType] = useState<SkillKey | "all">(initialType);
  const [level, setLevel] = useState<CEFRLevel | "all">("all");
  const [status, setStatus] = useState<ContentStatus | "all">("all");
  const [language, setLanguage] = useState<ContentLanguage | "all">("all");
  const [source, setSource] = useState<"all" | "curated" | "ai" | "imported">("all");
  const [sort, setSort] = useState<"updated" | "title" | "status">("updated");
  const [page, setPage] = useState(1);

  const [preview, setPreview] = useState<ContentItem | null>(null);
  const [pendingPublish, setPendingPublish] = useState<ContentItem | null>(null);
  const [pendingArchive, setPendingArchive] = useState<ContentItem | null>(null);

  const query = useMemo(
    () => ({ search, type, level, status, language, source, sort, page, page_size: PAGE_SIZE }),
    [search, type, level, status, language, source, sort, page],
  );

  const content = useContent(query);
  const stats = useContentStats();
  const updateStatus = useUpdateContentStatus();

  // Any filter change puts the reader back on the first page; otherwise page 4 of a new filter
  // silently shows nothing.
  const withReset = useCallback(<T,>(setter: (value: T) => void) => {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }, []);

  function resetFilters() {
    setSearch("");
    setType("all");
    setLevel("all");
    setStatus("all");
    setLanguage("all");
    setSource("all");
    setSort("updated");
    setPage(1);
    router.replace("/owner/cms");
  }

  function applyStatus(item: ContentItem, next: ContentStatus) {
    updateStatus.mutate(
      { id: item.id, status: next },
      {
        onSuccess: () =>
          toast({
            title: next === "published" ? `"${item.title}" published` : `"${item.title}" archived`,
            description: next === "published" ? "Learners can see it now." : "It is hidden from learners.",
            variant: "success",
          }),
        onError: () => toast({ title: "That change did not go through", variant: "error" }),
      },
    );
    setPendingPublish(null);
    setPendingArchive(null);
  }

  const columns: Column<ContentItem>[] = [
    {
      key: "title",
      header: "Content",
      width: "20rem",
      cell: (item) => (
        <div className="grid min-w-0 gap-0.5">
          {item.type === "grammar" ? (
            <Link href={`/owner/cms/grammar/${item.slug}`} className="truncate font-medium hover:underline">
              {item.title}
            </Link>
          ) : (
            <span className="truncate font-medium">{item.title}</span>
          )}
          <span className="truncate text-caption text-fg-muted">{item.category_name}</span>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      hideBelow: "sm",
      cell: (item) => <span className="text-fg-secondary">{skillLabels[item.type]}</span>,
    },
    { key: "level", header: "Level", hideBelow: "md", cell: (item) => <LevelBadge level={item.level} /> },
    {
      key: "languages",
      header: "Languages",
      hideBelow: "lg",
      cell: (item) => (
        <span className="text-caption text-fg-muted uppercase">
          {item.languages.map((code) => languageLabels[code]).join(" / ") || "—"}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (item) => <StatusBadge status={item.status} /> },
    {
      key: "updated",
      header: "Updated",
      hideBelow: "md",
      cell: (item) => <span className="text-fg-muted tabular-nums">{formatDate(item.updated_at)}</span>,
    },
    {
      key: "author",
      header: "Author",
      hideBelow: "xl",
      cell: (item) => <span className="text-fg-muted">{item.author}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      srOnlyHeader: true,
      width: "3rem",
      cell: (item) => (
        <ActionMenu
          label={`Actions for ${item.title}`}
          items={[
            { label: "View details", icon: Eye, onSelect: () => setPreview(item) },
            ...(item.type === "grammar"
              ? [
                  { label: "Edit lesson", icon: Pencil, href: `/owner/cms/grammar/${item.slug}` },
                  { label: "Preview as learner", icon: Eye, href: `/owner/cms/grammar/${item.slug}?tab=preview` },
                ]
              : []),
            {
              label: "Publish",
              icon: Send,
              separatorBefore: true,
              disabled: item.status === "published",
              onSelect: () => setPendingPublish(item),
            },
            {
              label: "Archive",
              icon: Archive,
              destructive: true,
              disabled: item.status === "archived",
              onSelect: () => setPendingArchive(item),
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
        title="Content management"
        description="Everything learners can open, across all seven skills."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "CMS" }]}
        actions={
          <Button size="sm" asChild>
            <Link href="/owner/cms/grammar/new">
              <SpellCheck aria-hidden />
              New grammar topic
            </Link>
          </Button>
        }
      />

      <section aria-label="Content totals" className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.isPending && Array.from({ length: 4 }, (_, index) => <StatCardSkeleton key={index} />)}
        {(stats.data ?? []).slice(0, 4).map((stat) => (
          <article key={stat.skill} className="grid gap-1 rounded-xl border bg-surface p-4">
            <h2 className="text-label text-fg-muted">{stat.label}</h2>
            <p className="text-h3 tabular-nums">{formatNumber(stat.total)}</p>
            <p className="text-caption text-fg-muted tabular-nums">
              {formatNumber(stat.published)} published · {formatNumber(stat.review)} in review · {formatNumber(stat.draft)} draft
            </p>
          </article>
        ))}
      </section>

      <FilterBar
        onReset={resetFilters}
        resultLabel={content.isPending ? undefined : `${formatNumber(total)} items`}
      >
        <SearchInput value={search} onChange={withReset(setSearch)} label="Search content" placeholder="Search by title" />
        <FilterSelect label="Content type" value={type} options={typeOptions} onChange={withReset(setType)} />
        <FilterSelect label="CEFR level" value={level} options={levelOptions} onChange={withReset(setLevel)} />
        <FilterSelect label="Status" value={status} options={statusOptions} onChange={withReset(setStatus)} />
        <FilterSelect label="Language" value={language} options={languageOptions} onChange={withReset(setLanguage)} />
        <FilterSelect label="Source" value={source} options={sourceOptions} onChange={withReset(setSource)} />
        <FilterSelect label="Sort by" value={sort} options={sortOptions} onChange={withReset(setSort)} />
      </FilterBar>

      <SectionCard title="All content" description="Filtered view of the catalogue" bodyClassName="p-0">
        <DataTable
          caption="Learner-facing content"
          columns={columns}
          rows={content.data?.items ?? []}
          rowKey={(item) => item.id}
          isLoading={content.isPending}
          isError={content.isError}
          error={content.error}
          onRetry={() => void content.refetch()}
          minWidth="58rem"
          empty={
            <EmptyState
              icon={FileStack}
              title="No content matches these filters"
              description="Try a different status or clear the search to see everything again."
              action={
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              }
            />
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
      </SectionCard>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preview?.title}</DialogTitle>
            <DialogDescription>{preview ? skillLabels[preview.type] : ""} content</DialogDescription>
          </DialogHeader>
          {preview && (
            <dl className="grid">
              <KeyValue label="Status">
                <StatusBadge status={preview.status} />
              </KeyValue>
              <KeyValue label="Category">{preview.category_name}</KeyValue>
              <KeyValue label="CEFR level">{preview.level}</KeyValue>
              <KeyValue label="Languages">
                {preview.languages.map((code) => languageLabels[code]).join(" / ") || "None yet"}
              </KeyValue>
              <KeyValue label="Source">{preview.source}</KeyValue>
              <KeyValue label="Author">{preview.author}</KeyValue>
              <KeyValue label="Updated">{formatDate(preview.updated_at)}</KeyValue>
              <KeyValue label="Published">{preview.published_at ? formatDate(preview.published_at) : "Not published"}</KeyValue>
              <KeyValue label="Slug">
                <code className="rounded bg-surface-active px-1.5 py-0.5 font-mono text-caption">{preview.slug}</code>
              </KeyValue>
            </dl>
          )}
          <DialogFooter>
            {preview?.type === "grammar" && (
              <Button variant="outline" asChild>
                <Link href={`/owner/cms/grammar/${preview.slug}`}>Open editor</Link>
              </Button>
            )}
            <Button onClick={() => setPreview(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingPublish !== null}
        onOpenChange={(open) => !open && setPendingPublish(null)}
        title={pendingPublish ? `Publish "${pendingPublish.title}"?` : ""}
        description="This will make the content available to learners."
        confirmLabel="Publish"
        loading={updateStatus.isPending}
        onConfirm={() => pendingPublish && applyStatus(pendingPublish, "published")}
      />

      <ConfirmDialog
        open={pendingArchive !== null}
        onOpenChange={(open) => !open && setPendingArchive(null)}
        title={pendingArchive ? `Archive "${pendingArchive.title}"?` : ""}
        description="Learners will no longer see this item. You can publish it again later."
        confirmLabel="Archive"
        destructive
        loading={updateStatus.isPending}
        onConfirm={() => pendingArchive && applyStatus(pendingArchive, "archived")}
      />
    </>
  );
}
