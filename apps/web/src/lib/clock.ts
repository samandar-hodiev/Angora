"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared ticking clock for countdowns. One interval serves every subscriber, and the
 * server snapshot is 0 so server-rendered markup never depends on the current time.
 */
let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 250);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  if (now === 0) now = Date.now();
  return now;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

const noopSubscribe = () => () => undefined;

/** True only after hydration; use to render browser-storage-dependent UI without mismatches. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
