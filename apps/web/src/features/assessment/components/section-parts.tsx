"use client";

import type { AssessmentSection } from "@engora/types";
import { CheckCircle2, Clock, CloudOff, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { SkillIcon } from "@/components/learning/skill-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { skillName } from "@/features/onboarding/labels";
import { formatDuration } from "@/lib/audio";
import { cn } from "@/lib/utils";

import type { SaveState } from "../use-section-timing";

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const content = {
    saving: { icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />, text: "Saving…", tone: "text-fg-muted" },
    saved: { icon: <CheckCircle2 className="size-3.5" aria-hidden />, text: "Saved", tone: "text-fg-muted" },
    error: { icon: <CloudOff className="size-3.5" aria-hidden />, text: "Not saved — retrying", tone: "text-error" },
  }[state];
  return (
    <span className={cn("hidden items-center gap-1.5 text-caption sm:inline-flex", content.tone)} role="status">
      {content.icon}
      {content.text}
    </span>
  );
}

/** Sticky section header: current section, question/task, section progress and the timer. */
export function SectionHeader({
  section,
  sectionCount,
  label,
  remainingMs,
  progress,
  saveState,
}: {
  section: AssessmentSection;
  sectionCount: number;
  label: string;
  remainingMs: number | null;
  progress: number;
  saveState?: SaveState;
}) {
  const low = remainingMs !== null && remainingMs < 60_000;
  return (
    <div className="journey-card sticky top-3 z-20 grid gap-2.5 rounded-xl px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
            <SkillIcon code={section.skill} className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-h4 leading-tight">
              {skillName(section.skill)}{" "}
              <span className="text-body-sm font-normal text-fg-muted">
                · Section {section.position} of {sectionCount}
              </span>
            </p>
            <p className="text-caption text-fg-muted">{label}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {saveState && <SaveIndicator state={saveState} />}
          <div
            role="timer"
            aria-label={`Time remaining ${formatDuration(remainingMs ?? 0)}`}
            className={cn(
              "flex items-center gap-1.5 rounded-md border bg-background/40 px-2.5 py-1 text-label tabular-nums",
              low && "border-error/50 text-error",
            )}
          >
            <Clock className="size-3.5" aria-hidden />
            {remainingMs === null ? "--:--" : formatDuration(remainingMs)}
          </div>
        </div>
      </div>
      <Progress value={progress} aria-label={`${skillName(section.skill)} section progress`} className="h-1" />
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep working
          </Button>
          <Button variant="liquid" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
