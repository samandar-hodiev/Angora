"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

import { useHints } from "./hints";

/*
 * The search box and filter menus every lexicon page shares — vocabulary, phrases,
 * collocations, irregular verbs — so they look and behave the same everywhere.
 */

/**
 * The search box, made to look like one: a search mark in its own tile, the field, and a "/"
 * hint that it can be reached from the keyboard — "/" anywhere on the page puts the cursor in it.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const h = useHints();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "/" || target?.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <label
      className={cn(
        "group flex h-11 min-w-64 flex-1 items-center gap-2 rounded-xl border bg-surface pr-2 pl-1.5 transition-[border-color,box-shadow] duration-micro",
        "focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/30 hover:border-primary/40",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
        <Search className="size-4" aria-hidden />
      </span>
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        title={h.search}
        className="h-full min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={h.clearSearch}
          title={h.clearSearch}
          onClick={() => onChange("")}
          className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : (
        <kbd className="hidden rounded border px-1.5 text-[0.6875rem] text-fg-muted sm:block" title={h.search}>
          /
        </kbd>
      )}
    </label>
  );
}

/** A filter as a button that says what it is set to, opening a menu of its choices. */
export function FilterMenu({
  icon: Icon,
  label,
  value,
  active,
  wide,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  hint: string;
  value: string;
  active: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={hint}
          className={cn(
            "flex h-11 items-center gap-2 rounded-xl border px-3 text-body-sm outline-none transition-colors duration-micro",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:border-primary",
            active ? "border-primary/60 bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:border-primary/40",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="text-fg-muted">{label}:</span>
          <span className="font-medium whitespace-nowrap">{value}</span>
          <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("max-h-[70vh] overflow-y-auto", wide ? "w-72" : "w-64")}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MenuCount({ n }: { n: number }) {
  return <span className="ml-auto text-caption text-fg-muted tabular-nums">{n}</span>;
}

/** A filter that is on, with a way to turn it off. */
export function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  const h = useHints();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary-subtle py-0.5 pr-1 pl-2.5 text-caption text-primary-subtle-foreground capitalize">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`${h.removeFilter}: ${label}`}
        title={h.removeFilter}
        className="grid size-4 place-items-center rounded-full hover:bg-primary/20"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}
