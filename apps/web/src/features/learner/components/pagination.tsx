"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3">
      <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        <ChevronLeft aria-hidden /> Previous
      </Button>
      <span className="text-body-sm text-fg-muted tabular-nums">
        Page {page} of {pages}
      </span>
      <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
        Next <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}
