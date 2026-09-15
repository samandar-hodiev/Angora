"use client";

import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { LiquidBackground } from "@/components/common/liquid-background";
import { cn } from "@/lib/utils";

export const speakingAnalysisSteps = [
  "Listening to your answer",
  "Analysing grammar",
  "Checking vocabulary",
  "Evaluating fluency",
  "Preparing recommendations",
];

/**
 * Intentional AI processing state: named steps instead of an anonymous spinner. Pass
 * `currentStep` from real job progress, or `autoAdvanceMs` to preview the sequence.
 */
export function AIProcessingState({
  title = "Analysing your speaking…",
  steps = speakingAnalysisSteps,
  currentStep,
  autoAdvanceMs,
  className,
}: {
  title?: string;
  steps?: string[];
  currentStep?: number;
  autoAdvanceMs?: number;
  className?: string;
}) {
  const [auto, setAuto] = useState(0);

  useEffect(() => {
    if (!autoAdvanceMs) return;
    const timer = window.setInterval(() => setAuto((s) => (s + 1) % (steps.length + 1)), autoAdvanceMs);
    return () => window.clearInterval(timer);
  }, [autoAdvanceMs, steps.length]);

  const active = currentStep ?? auto;

  return (
    <div className={cn("relative isolate overflow-hidden rounded-xl border bg-surface", className)}>
      <LiquidBackground intensity="subtle" />
      <div className="relative grid gap-6 p-6 sm:p-8">
        <div className="flex items-center gap-4">
          <span className="relative grid size-12 place-items-center">
            <span className="absolute inset-0 animate-breathe rounded-full bg-primary/20 motion-reduce:animate-none" aria-hidden />
            <span className="size-5 rounded-full bg-primary" aria-hidden />
          </span>
          <div>
            <p className="text-h4">{title}</p>
            <p className="text-body-sm text-fg-muted">This usually takes under a minute. You can leave this page.</p>
          </div>
        </div>
        <ol className="grid gap-2.5" aria-live="polite">
          {steps.map((step, i) => {
            const state = i < active ? "done" : i === active ? "active" : "pending";
            return (
              <li
                key={step}
                className={cn(
                  "flex items-center gap-3 text-body-sm transition-colors duration-normal",
                  state === "pending" ? "text-fg-disabled" : "text-foreground",
                )}
              >
                <span className="grid size-5 place-items-center">
                  {state === "done" && <Check className="size-4 text-success" aria-label="Done" />}
                  {state === "active" && <Loader2 className="size-4 animate-spin text-primary" aria-label="In progress" />}
                  {state === "pending" && <span className="size-1.5 rounded-full bg-fg-disabled" aria-hidden />}
                </span>
                {step}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
