"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formatNumber } from "../lib/format";

/**
 * One table for the whole console.
 *
 * Columns declare what they render and when they may disappear, so every table narrows the
 * same way instead of each page inventing its own responsive behaviour. The table body always
 * resolves to one of four states — loading, error, empty, rows — and the page never has to
 * handle them itself.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Columns drop from the narrowest breakpoint up, so the identifying column always stays. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  align?: "left" | "right";
  width?: string;
  srOnlyHeader?: boolean;
}

const hideClasses = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  empty,
  skeletonRows = 8,
  onRowClick,
  minWidth = "42rem",
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  skeletonRows?: number;
  onRowClick?: (row: T) => void;
  /** Below this the table scrolls sideways inside its card instead of crushing its columns. */
  minWidth?: string;
  className?: string;
}) {
  if (isError) {
    return (
      <div className="p-4">
        <ErrorState error={error} title="This list could not be loaded" onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table style={{ minWidth }} className="w-full border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  "px-4 py-2.5 text-label font-medium whitespace-nowrap text-fg-muted",
                  column.align === "right" && "text-right",
                  column.hideBelow && hideClasses[column.hideBelow],
                )}
              >
                {column.srOnlyHeader ? <span className="sr-only">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading && rows.length === 0
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={index} className="border-b last:border-b-0">
                  {columns.map((column) => (
                    <td key={column.key} className={cn("px-4 py-3", column.hideBelow && hideClasses[column.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-28" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b transition-colors duration-micro last:border-b-0 hover:bg-surface-hover",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-4 py-2.5 align-middle",
                        column.align === "right" && "text-right",
                        column.hideBelow && hideClasses[column.hideBelow],
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!isLoading && rows.length === 0 && <div className="p-4">{empty}</div>}
    </div>
  );
}

/**
 * Client-side for now. The props are the ones a server-paginated endpoint returns
 * (page / total / total_pages), so only the data source changes later.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  label = "results",
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-body-sm"
    >
      <p className="text-fg-muted tabular-nums">
        {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)} {label}
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <span className="px-2 text-caption text-fg-muted tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
