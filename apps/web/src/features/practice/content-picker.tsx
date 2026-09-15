"use client";

import type { ContentSummary } from "@engora/types";
import { FileQuestion } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentList } from "@/features/learning/hooks";

import type { ContentFilters } from "../learning/api";

/** Loads published content for a practice page and tracks the selected item in the URL. */
export function useContentSelection(filters: ContentFilters, initialId?: string) {
  const list = useContentList({ page_size: 50, ...filters });
  const router = useRouter();
  const pathname = usePathname();
  const [selectedId, setSelectedId] = useState(initialId);
  const items = list.data?.items ?? [];
  const current = items.find((i) => i.id === selectedId) ?? items[0];

  const select = (id: string) => {
    setSelectedId(id);
    router.replace(`${pathname}?content=${id}`, { scroll: false });
  };

  return { list, items, current, select };
}

export function ContentPicker({ items, current, onSelect, label }: { items: ContentSummary[]; current?: ContentSummary; onSelect: (id: string) => void; label: string }) {
  if (items.length < 2) return null;
  return (
    <div className="grid gap-2">
      <Label htmlFor="content-picker">{label}</Label>
      <NativeSelect id="content-picker" value={current?.id} onChange={(e) => onSelect(e.target.value)}>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.level ? `${item.level} · ` : ""}
            {item.title}
            {item.exam ? ` (${item.exam.toUpperCase()})` : ""}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Shared frame: header, loading, error and empty states for content-driven practice pages. */
export function PracticeFrame({
  skill,
  title,
  description,
  list,
  emptyTitle,
  children,
}: {
  skill: string;
  title: string;
  description: string;
  list: ReturnType<typeof useContentList>;
  emptyTitle: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <SkillIcon code={skill} className="size-4 text-primary" />
            Practice
          </span>
        }
        title={title}
        description={description}
      />
      {list.isPending ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : list.isError ? (
        <ErrorState title="Couldn't load exercises" error={list.error} onRetry={() => void list.refetch()} />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon={FileQuestion} title={emptyTitle} description="New exercises are published regularly. Check back soon." />
      ) : (
        children
      )}
    </>
  );
}
