"use client";

import type { AssessmentSkill } from "@engora/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { assessmentApi } from "@/features/assessment/api";
import { isApiError } from "@/lib/api/errors";
import { useNow } from "@/lib/clock";

/**
 * Time left in a section. The deadline comes from the server; `receivedAt` (when the section
 * payload arrived) corrects for a wrong device clock. `onExpire` runs once at zero — the server
 * enforces the deadline anyway, so a closed tab is handled too.
 */
export function useCountdown({
  deadlineAt,
  serverTime,
  receivedAt,
  onExpire,
}: {
  deadlineAt: string | null;
  serverTime: string;
  receivedAt: number;
  onExpire: () => void;
}): number | null {
  const now = useNow();
  const offset = Date.parse(serverTime) - receivedAt;
  const remaining = deadlineAt && now > 0 ? Math.max(0, Date.parse(deadlineAt) - (now + offset)) : null;
  const fired = useRef(false);
  const expire = useRef(onExpire);

  useEffect(() => {
    expire.current = onExpire;
  });

  useEffect(() => {
    if (remaining === 0 && !fired.current) {
      fired.current = true;
      expire.current();
    }
  }, [remaining]);

  return remaining;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Saves answers as the learner works: queued per item (latest value wins), retried while
 * offline, and flushed before submitting. Nothing completed is lost to a refresh.
 */
export function useAnswerSaver(assessmentId: string, skill: AssessmentSkill) {
  const [state, setState] = useState<SaveState>("idle");
  const pending = useRef(new Map<string, { response: Record<string, unknown>; timeSpent: number }>());
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const drain = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    const task = (async () => {
      while (pending.current.size > 0) {
        const [itemId, entry] = pending.current.entries().next().value as [string, { response: Record<string, unknown>; timeSpent: number }];
        pending.current.delete(itemId);
        setState("saving");
        try {
          await assessmentApi.saveAnswer(assessmentId, skill, itemId, entry.response, entry.timeSpent);
        } catch (error) {
          // The section closed (time up / submitted elsewhere): retrying cannot help.
          if (isApiError(error) && error.status >= 400 && error.status < 500) continue;
          if (!pending.current.has(itemId)) pending.current.set(itemId, entry);
          setState("error");
          throw error;
        }
      }
      setState("saved");
    })();
    inflight.current = task.finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, [assessmentId, skill]);

  const schedule = useCallback(
    (delay: number) => {
      clearTimeout(timer.current);
      const tick = () => {
        drain().catch(() => {
          timer.current = setTimeout(tick, 3000);
        });
      };
      timer.current = setTimeout(tick, delay);
    },
    [drain],
  );

  const save = useCallback(
    (itemId: string, response: Record<string, unknown>, timeSpent = 0, delay = 0) => {
      pending.current.set(itemId, { response, timeSpent });
      setState("saving");
      schedule(delay);
    },
    [schedule],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      await drain();
    } catch {
      // Submission still proceeds with what the server already has.
    }
  }, [drain]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { state, save, flush };
}
