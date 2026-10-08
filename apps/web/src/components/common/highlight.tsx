"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Marks what a search found. A page that searches wraps its results in a HighlightProvider
 * with the query; every <Highlight> inside it then marks the matching part of its text in
 * light yellow — so the eye lands on why a row is there. Outside a provider, or with an
 * empty query, it prints the text unchanged.
 */
const HighlightContext = createContext("");

export function HighlightProvider({ query, children }: { query: string; children: ReactNode }) {
  return <HighlightContext.Provider value={query}>{children}</HighlightContext.Provider>;
}

export function Highlight({ text, query }: { text: string | null | undefined; query?: string }) {
  const fromContext = useContext(HighlightContext);
  const q = (query ?? fromContext).trim();
  if (!text) return null;
  if (!q) return <>{text}</>;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="rounded-[3px] bg-yellow-200 px-0.5 text-neutral-900">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
