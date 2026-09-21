"use client";

import { Archive, ClipboardList, Eye, Pencil, Plus, Send } from "lucide-react";
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
import { useQuestionStats, useQuestions, useSetQuestionStatus } from "../hooks";
import { formatDate, formatNumber } from "../lib/format";
import type {
  AssessmentSkill,
  CEFRLevel,
  QuestionItemType,
  QuestionRow,
  QuestionStatus,
} from "../types";
import { assessmentSkills, cefrLevels, questionItemTypes, questionStatuses } from "../types";
import { QuestionEditor } from "./question-editor";

const PAGE_SIZE = 20;

const typeLabels: Record<QuestionItemType, string> = {
  multiple_choice: "Multiple choice",
  true_false_not_given: "True / False / Not given",
  vocabulary_in_context: "Vocabulary in context",
  writing_task: "Writing task",
  speaking_task: "Speaking task",
};

const statusLabels: Record<QuestionStatus, string> = {
  draft: "Draft",
  review: "Review",
  published: "Published",
  archived: "Archived",
};

const statusStyles: Record<QuestionStatus, string> = {
  draft: "border-transparent bg-surface-active text-fg-secondary",
  review: "border-transparent bg-warning/20 text-warning-foreground",
  published: "border-transparent bg-success/15 text-success",
  archived: "border-transparent bg-surface-active text-fg-muted line-through",
};

const skillLabels: Record<AssessmentSkill, string> = {
  reading: "Reading",
  listening: "Listening",
  writing: "Writing",
  speaking: "Speaking",
};

/**
 * The question bank.
 *
 * Every row here is an `assessment_items` row the placement engine already reads: publishing
 * one puts it in front of learners, and its answer key is what marks their answer. That is why
 * the status action goes through a confirmation and why the API re-validates on publish.
 */
export function QuestionBankView() {
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState<AssessmentSkill | "all">("all");
  const [level, setLevel] = useState<CEFRLevel | "all">("all");
  const [status, setStatus] = useState<QuestionStatus | "all">("all");
  const [itemType, setItemType] = useState<QuestionItemType | "all">("all");
  const [sort, setSort] = useState<"updated" | "slug" | "difficulty">("updated");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [pending, setPending] = useState<{ row: QuestionRow; status: QuestionStatus } | null>(null);

  const query = useMemo(
    () => ({ search, skill, level, status, item_type: itemType, sort, page, page_size: PAGE_SIZE }),
    [search, skill, level, status, itemType, sort, page],
  );
  const questions = useQuestions(query);
  const setStatusMutation = useSetQuestionStatus();

  function reset() {
    setSearch("");
    setSkill("all");
    setLevel("all");
    setStatus("all");
    setItemType("all");
    setSort("updated");
    setPage(1);
  }

  function applyStatus(row: QuestionRow, next: QuestionStatus) {
    setStatusMutation.mutate(
      { id: row.id, status: next },
      {
        onSuccess: () =>
          toast({
            title: next === "published" ? `"${row.slug}" published` : `"${row.slug}" moved to ${statusLabels[next]}`,
            description: next === "published" ? "Learners can now be given this question." : undefined,
            variant: "success",
          }),
        onError: (error) =>
          toast({
            title: "That change was refused",
            // The API rejects an unanswerable item; showing its reason is the whole point.
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
      },
    );
    setPending(null);
  }

  const columns: Column<QuestionRow>[] = [
    {
      key: "prompt",
      header: "Question",
      width: "24rem",
      cell: (row) => (
        <div className="grid min-w-0 gap-0.5">
          <button
            type="button"
            onClick={() => setEditing({ id: row.id })}
            className="truncate text-left font-medium hover:underline"
          >
            {row.prompt}
          </button>
          <span className="truncate font-mono text-caption text-fg-muted">{row.slug}</span>
        </div>
      ),
    },
    { key: "skill", header: "Skill", cell: (row) => <span className="text-fg-secondary">{skillLabels[row.skill]}</span> },
    { key: "level", header: "CEFR", cell: (row) => <LevelBadge level={row.level} /> },
    {
      key: "type",
      header: "Type",
      hideBelow: "lg",
      cell: (row) => <span className="text-fg-secondary">{typeLabels[row.item_type] ?? row.item_type}</span>,
    },
    {
      key: "difficulty",
      header: "Difficulty",
      hideBelow: "xl",
      cell: (row) => <span className="tabular-nums">{row.difficulty}/10</span>,
    },
    {
      key: "options",
      header: "Options",
      hideBelow: "xl",
      cell: (row) =>
        row.option_count > 0 ? (
          <span className="tabular-nums">{row.option_count}</span>
        ) : (
          <span className="text-fg-muted">Task</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge className={statusStyles[row.status]}>{statusLabels[row.status]}</Badge>,
    },
    {
      key: "updated",
      header: "Updated",
      hideBelow: "md",
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
          label={`Actions for ${row.slug}`}
          items={[
            { label: "Edit question", icon: Pencil, onSelect: () => setEditing({ id: row.id }) },
            {
              label: "Send to review",
              icon: Eye,
              separatorBefore: true,
              disabled: row.status === "review",
              onSelect: () => applyStatus(row, "review"),
            },
            {
              label: "Publish",
              icon: Send,
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

  const total = questions.data?.total ?? 0;

  return (
    <>
      <OwnerPageHeader
        title="Question bank"
        description="The items placement and skill assessments are built from. Published items are live for learners."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Assessments", href: "/owner/assessments" }, { label: "Question bank" }]}
        actions={
          <Button size="sm" onClick={() => setEditing({ id: null })}>
            <Plus aria-hidden />
            New question
          </Button>
        }
      />

      <CoverageCard />

      <FilterBar onReset={reset} resultLabel={questions.isPending ? undefined : `${formatNumber(total)} questions`}>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label="Search questions"
          placeholder="Search prompt or slug"
        />
        <FilterSelect
          label="Skill"
          value={skill}
          options={[{ value: "all" as const, label: "All skills" }, ...assessmentSkills.map((s) => ({ value: s, label: skillLabels[s] }))]}
          onChange={(value) => {
            setSkill(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="CEFR level"
          value={level}
          options={[{ value: "all" as const, label: "All levels" }, ...cefrLevels.map((l) => ({ value: l, label: l }))]}
          onChange={(value) => {
            setLevel(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={[{ value: "all" as const, label: "All statuses" }, ...questionStatuses.map((s) => ({ value: s, label: statusLabels[s] }))]}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Question type"
          value={itemType}
          options={[{ value: "all" as const, label: "All types" }, ...questionItemTypes.map((t) => ({ value: t, label: typeLabels[t] }))]}
          onChange={(value) => {
            setItemType(value);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Sort"
          value={sort}
          options={[
            { value: "updated" as const, label: "Last updated" },
            { value: "slug" as const, label: "Slug A–Z" },
            { value: "difficulty" as const, label: "Difficulty" },
          ]}
          onChange={setSort}
        />
      </FilterBar>

      <SectionCard title="Questions" description="Live from the platform database" bodyClassName="p-0">
        {questions.isError ? (
          <div className="p-4">
            <LiveDataState error={questions.error} onRetry={() => void questions.refetch()} />
          </div>
        ) : (
          <>
            <DataTable
              caption="Assessment question bank"
              columns={columns}
              rows={questions.data?.items ?? []}
              rowKey={(row) => row.id}
              isLoading={questions.isPending}
              minWidth="66rem"
              empty={
                <div className="grid justify-items-center gap-3 py-6 text-center">
                  <ClipboardList className="size-8 text-fg-muted" aria-hidden />
                  <div>
                    <p className="text-h4">No questions match these filters</p>
                    <p className="text-body-sm text-fg-secondary">
                      Clear the filters, or add the first question for this skill and level.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={reset}>
                      Clear filters
                    </Button>
                    <Button size="sm" onClick={() => setEditing({ id: null })}>
                      <Plus aria-hidden />
                      New question
                    </Button>
                  </div>
                </div>
              }
            />
            <Pagination
              page={questions.data?.page ?? 1}
              totalPages={questions.data?.total_pages ?? 1}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              label="questions"
            />
          </>
        )}
      </SectionCard>

      {editing && <QuestionEditor questionId={editing.id} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.status === "published"
            ? `Publish "${pending?.row.slug}"?`
            : `Archive "${pending?.row.slug}"?`
        }
        description={
          pending?.status === "published"
            ? "Learners can be given this question from their next assessment onwards. Its answer key decides whether they are marked correct."
            : "The question stops being selected for new assessments. Results already recorded are unaffected."
        }
        confirmLabel={pending?.status === "published" ? "Publish" : "Archive"}
        destructive={pending?.status === "archived"}
        loading={setStatusMutation.isPending}
        onConfirm={() => pending && applyStatus(pending.row, pending.status)}
      />
    </>
  );
}

/**
 * Coverage is the question the bank has to answer before a placement test can be trusted:
 * every skill × level cell a config draws from needs published items, and an empty cell is a
 * test that cannot measure that level.
 */
function CoverageCard() {
  const stats = useQuestionStats();

  if (stats.isError) {
    return (
      <SectionCard title="Coverage" description="Published items per skill and level" className="mb-5">
        <LiveDataState error={stats.error} onRetry={() => void stats.refetch()} />
      </SectionCard>
    );
  }

  const byCell = new Map((stats.data?.coverage ?? []).map((c) => [`${c.skill}:${c.level}`, c]));
  const published = stats.data?.by_status.find((b) => b.key === "published")?.count ?? 0;

  return (
    <SectionCard
      title="Coverage"
      description={
        stats.isPending
          ? "Published items per skill and level"
          : `${formatNumber(published)} of ${formatNumber(stats.data?.total ?? 0)} items published`
      }
      className="mb-5"
    >
      {stats.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-body-sm">
            <caption className="sr-only">Published question count per skill and CEFR level</caption>
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left text-label text-fg-muted">
                  Skill
                </th>
                {cefrLevels.map((level) => (
                  <th key={level} scope="col" className="px-2 py-1.5 text-center text-label text-fg-muted">
                    {level}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assessmentSkills.map((skill) => (
                <tr key={skill} className="border-t">
                  <th scope="row" className="px-2 py-2 text-left font-medium">
                    {skillLabels[skill]}
                  </th>
                  {cefrLevels.map((level) => {
                    const cell = byCell.get(`${skill}:${level}`);
                    const count = cell?.published ?? 0;
                    return (
                      <td key={level} className="px-2 py-2 text-center">
                        <span
                          title={cell ? `${cell.published} published, ${cell.draft} not published` : "No items"}
                          className={cn(
                            "inline-grid h-7 w-10 place-items-center rounded-md tabular-nums",
                            count === 0 && "bg-surface-active text-fg-disabled",
                            count > 0 && count < 3 && "bg-warning/20 text-warning-foreground",
                            count >= 3 && "bg-success/15 text-success",
                          )}
                        >
                          {count}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-caption text-fg-muted">
            Amber marks a level with fewer than three published items — too few for a section to select from without
            repeating.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
