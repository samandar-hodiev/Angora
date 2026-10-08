"use client";

import { Search, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The learner app's one search box, made to look like one so nobody has to hunt for it: a
 * search mark in its own tile, the field, and a "/" hint — "/" anywhere on the page puts the
 * cursor in it. Escape clears it. Every page that searches uses this, so they all look and
 * behave the same.
 */
export const SearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    label: string;
    /** Tooltip naming the "/" shortcut. */
    hint?: string;
    clearLabel?: string;
    className?: string;
  }
>(function SearchField(
  { value, onChange, placeholder, label, hint = "Search — press / to jump here", clearLabel = "Clear search", className },
  ref,
) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!);
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
        className,
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
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        aria-label={label}
        title={hint}
        className="h-full min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : (
        <kbd className="hidden rounded border px-1.5 text-[0.6875rem] text-fg-muted sm:block" title={hint}>
          /
        </kbd>
      )}
    </label>
  );
});
