/**
 * Deterministic helpers for the mock layer.
 *
 * Every dataset in ../data is generated from a fixed seed and a fixed "today", so the server
 * render and the client render produce identical markup and a reload never reshuffles the
 * numbers the Owner was just reading. Nothing here survives the real backend.
 */

import type { ISODate, RangeKey } from "../types";

/** The day the mock platform is frozen at. Never `new Date()` — that breaks hydration. */
export const MOCK_TODAY = "2026-09-21";

/** mulberry32: small, fast, and stable across runtimes. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

export function between(random: () => number, min: number, max: number): number {
  return Math.round(min + random() * (max - min));
}

/** A stable pseudo-UUID, so ids look like the ones the API will return. */
export function mockId(prefix: string, index: number): string {
  const random = seededRandom(seedFrom(`${prefix}:${index}`));
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

// ---- Dates --------------------------------------------------------------------------------

const DAY = 86_400_000;

export function dayOffset(days: number, from: ISODate = MOCK_TODAY): ISODate {
  return new Date(Date.parse(`${from}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
}

/** An ISO timestamp `days` before MOCK_TODAY at a stable time of day. */
export function timestampOffset(days: number, hour = 9, minute = 0): ISODate {
  const ms = Date.parse(`${MOCK_TODAY}T00:00:00.000Z`) - days * DAY + hour * 3_600_000 + minute * 60_000;
  return new Date(ms).toISOString();
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

export const rangeDays: Record<RangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "3m": 90,
  "6m": 182,
  "12m": 365,
};

export const rangeLabels: Record<RangeKey, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "3m": "3 months",
  "6m": "6 months",
  "12m": "12 months",
};

/** Simulated network latency, so loading states are real code paths and not decoration. */
export function delay<T>(value: T, ms = 160): Promise<T> {
  if (typeof window === "undefined") return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
