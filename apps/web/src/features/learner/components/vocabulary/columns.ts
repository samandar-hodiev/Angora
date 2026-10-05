"use client";

import { useSyncExternalStore } from "react";

/**
 * Which languages the lexicon list shows, and in what order — the learner's own arrangement,
 * kept in this browser. English first by default; a learner can lead with Uzbek or Russian,
 * or drop one language, but never below two.
 */

export type Lang = "en" | "uz" | "ru";

export interface Columns {
  order: Lang[];
  hidden: Lang[];
}

export const DEFAULT_COLUMNS: Columns = { order: ["en", "uz", "ru"], hidden: [] };

const KEY = "engora.lexicon.columns";
const listeners = new Set<() => void>();
let cached: Columns | null = null;

function valid(c: unknown): c is Columns {
  if (!c || typeof c !== "object") return false;
  const { order, hidden } = c as Columns;
  return (
    Array.isArray(order) &&
    order.length === 3 &&
    ["en", "uz", "ru"].every((l) => order.includes(l as Lang)) &&
    Array.isArray(hidden) &&
    hidden.length <= 1 &&
    hidden.every((l) => order.includes(l))
  );
}

function read(): Columns {
  if (cached) return cached;
  cached = DEFAULT_COLUMNS;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (valid(parsed)) cached = parsed;
  } catch {
    /* storage unavailable: the default arrangement */
  }
  return cached;
}

function write(next: Columns) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the arrangement lasts until the page is left */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Moves a language one place left (-1) or right (+1). */
export function moved(c: Columns, lang: Lang, by: -1 | 1): Columns {
  const order = [...c.order];
  const at = order.indexOf(lang);
  const to = at + by;
  if (to < 0 || to >= order.length) return c;
  [order[at], order[to]] = [order[to]!, order[at]!];
  return { ...c, order };
}

/** Shows or hides a language; hiding is refused when only two are showing. */
export function toggled(c: Columns, lang: Lang): Columns {
  if (c.hidden.includes(lang)) return { ...c, hidden: c.hidden.filter((l) => l !== lang) };
  if (c.order.length - c.hidden.length <= 2) return c;
  return { ...c, hidden: [...c.hidden, lang] };
}

export function useColumns(): [Columns, (next: Columns) => void] {
  const columns = useSyncExternalStore(subscribe, read, () => DEFAULT_COLUMNS);
  return [columns, write];
}

/** The languages showing, in order. */
export function shown(c: Columns): Lang[] {
  return c.order.filter((l) => !c.hidden.includes(l));
}
