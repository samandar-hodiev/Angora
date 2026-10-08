"use client";

import type { CEFRLevel } from "@/features/mock-exam/sample";
import { Clock, Eye, ListChecks, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockSkillIcons } from "@/features/mock-exam/learner-home";
import { mockSkillLabels, mockSkills, sampleSection, sampleSets, type MockSet, type MockSkill } from "@/features/mock-exam/sample";
import { cn } from "@/lib/utils";

import { ActionMenu, ConfirmDialog, OwnerPageHeader, SegmentedControl, StatusBadge } from "../components/primitives";
import { cefrLevels } from "../types";

/**
 * Mock exam — where the owner builds the timed exams learners sit, per level and per skill.
 *
 * UI only for now: the sets below are sample data held in the page, and "Generate" adds
 * drafts locally. The layout is what the backend will fill: one row per level, a column per
 * skill, every set a draft until it is published.
 */
export function MockExamView() {
  const [sets, setSets] = useState<MockSet[]>(() => sampleSets());
  const [level, setLevel] = useState<CEFRLevel | "all">("all");
  const [generating, setGenerating] = useState(false);
  const [removing, setRemoving] = useState<MockSet | null>(null);

  const shownLevels = level === "all" ? cefrLevels : [level];
  const drafts = sets.filter((s) => s.status === "draft").length;
  const live = sets.length - drafts;

  const publish = (ids: string[]) => setSets((all) => all.map((s) => (ids.includes(s.id) ? { ...s, status: "published" } : s)));

  return (
    <>
      <OwnerPageHeader
        title="Mock exam"
        description="Timed exams learners sit at a level they choose — listening, reading, writing and speaking, built for every level."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Content CMS", href: "/owner/content" }, { label: "Mock exam" }]}
        actions={
          <>
            {drafts > 0 && (
              <Button variant="outline" onClick={() => publish(sets.filter((s) => s.status === "draft").map((s) => s.id))}>
                <Send aria-hidden /> Publish all drafts ({drafts})
              </Button>
            )}
            <Button onClick={() => setGenerating(true)}>
              <Sparkles aria-hidden /> Generate with AI
            </Button>
          </>
        }
      />

      <p className="mb-4 rounded-lg border border-dashed px-4 py-2.5 text-caption text-fg-muted">
        Preview of the screen with sample data — not connected to the backend yet. Changes here are not saved.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Summary label="Exams in the library" value={sets.length} />
        <Summary label="Waiting to publish" value={drafts} tone={drafts ? "warning" : undefined} />
        <Summary label="Live for learners" value={live} tone="success" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Level"
          value={level}
          options={[{ value: "all", label: "All levels" }, ...cefrLevels.map((code) => ({ value: code, label: code }))]}
          onChange={setLevel}
        />
      </div>

      <div className="grid gap-4">
        {shownLevels.map((code) => (
          <section key={code} aria-labelledby={`mock-${code}`} className="rounded-xl border bg-surface">
            <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
              <span
                id={`mock-${code}`}
                className="grid h-7 min-w-10 place-items-center rounded-md bg-primary-subtle px-2 text-body-sm font-semibold text-primary-subtle-foreground"
              >
                {code}
              </span>
              <span className="text-body-sm text-fg-secondary">
                {sets.filter((s) => s.level === code).length} exams ·{" "}
                {sets.filter((s) => s.level === code && s.status === "published").length} live
              </span>
            </header>
            <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-4">
              {mockSkills.map((skill) => (
                <SkillColumn
                  key={skill}
                  level={code}
                  skill={skill}
                  sets={sets.filter((s) => s.level === code && s.skill === skill)}
                  onPublish={(id) => publish([id])}
                  onRemove={setRemoving}
                  onGenerate={() => setGenerating(true)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <GenerateDialog
        key={generating ? "open" : "closed"}
        open={generating}
        onOpenChange={setGenerating}
        initialLevel={level === "all" ? null : level}
        onGenerate={(levels, skills, count) => {
          const now = new Date().toISOString();
          const added: MockSet[] = [];
          for (const l of levels) {
            for (const skill of skills) {
              const existing = sets.filter((s) => s.level === l && s.skill === skill).length;
              const section = sampleSection(skill, l);
              for (let i = 1; i <= count; i++) {
                added.push({
                  id: `${l}-${skill}-${existing + i}-${now}`,
                  level: l,
                  skill,
                  title: `${l} ${mockSkillLabels[skill]} · Mock ${existing + i}`,
                  questions: section.questions?.length ?? 1,
                  minutes: section.minutes,
                  status: "draft",
                  source: "ai",
                  updatedAt: now,
                });
              }
            }
          }
          setSets((all) => [...all, ...added]);
          setGenerating(false);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this exam?"
        description={removing ? `${removing.title} will be removed. Learners who already sat it keep their results.` : ""}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setSets((all) => all.filter((s) => s.id !== removing?.id));
          setRemoving(null);
        }}
      />
    </>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "warning" | "success" }) {
  return (
    <div className="rounded-xl border bg-surface px-4 py-3">
      <p className="text-caption text-fg-muted">{label}</p>
      <p className={cn("text-h3 tabular-nums", tone === "warning" && "text-warning-text", tone === "success" && "text-success")}>{value}</p>
    </div>
  );
}

function SkillColumn({
  level,
  skill,
  sets,
  onPublish,
  onRemove,
  onGenerate,
}: {
  level: CEFRLevel;
  skill: MockSkill;
  sets: MockSet[];
  onPublish: (id: string) => void;
  onRemove: (set: MockSet) => void;
  onGenerate: () => void;
}) {
  const Icon = mockSkillIcons[skill];
  return (
    <div className="grid content-start gap-2 bg-surface p-3">
      <div className="flex items-center gap-2 px-1">
        <Icon className="size-4 text-fg-muted" aria-hidden />
        <span className="text-body-sm font-medium">{mockSkillLabels[skill]}</span>
        <span className="ml-auto text-caption text-fg-muted tabular-nums">{sets.length}</span>
      </div>
      {sets.length === 0 ? (
        <button
          type="button"
          onClick={onGenerate}
          className="grid place-items-center gap-1 rounded-lg border border-dashed py-6 text-caption text-fg-muted outline-none transition-colors duration-micro hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Plus className="size-4" aria-hidden />
          No {level} {mockSkillLabels[skill].toLowerCase()} exam yet
        </button>
      ) : (
        <ul className="grid gap-2">
          {sets.map((set) => (
            <li key={set.id} className="grid gap-1.5 rounded-lg border px-3 py-2.5">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-body-sm font-medium">{set.title}</span>
                <ActionMenu
                  label={`Actions for ${set.title}`}
                  items={[
                    {
                      label: "Preview as learner",
                      icon: Eye,
                      onSelect: () => window.open(`/app/mock-exam/${set.skill}?level=${set.level}`, "_blank", "noopener"),
                    },
                    ...(set.status === "draft" ? [{ label: "Publish", icon: Send, onSelect: () => onPublish(set.id) }] : []),
                    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => onRemove(set) },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
                <span className="flex items-center gap-1">
                  <Clock className="size-3" aria-hidden /> {set.minutes} min
                </span>
                {skill !== "writing" && skill !== "speaking" && (
                  <span className="flex items-center gap-1">
                    <ListChecks className="size-3" aria-hidden /> {set.questions} q
                  </span>
                )}
                {set.source === "ai" && (
                  <span className="flex items-center gap-1">
                    <Sparkles className="size-3" aria-hidden /> AI
                  </span>
                )}
                <StatusBadge status={set.status} className="ml-auto" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GenerateDialog({
  open,
  onOpenChange,
  initialLevel,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLevel: CEFRLevel | null;
  onGenerate: (levels: CEFRLevel[], skills: MockSkill[], count: number) => void;
}) {
  const [levels, setLevels] = useState<CEFRLevel[]>(initialLevel ? [initialLevel] : [...cefrLevels]);
  const [skills, setSkills] = useState<MockSkill[]>([...mockSkills]);
  const [count, setCount] = useState(1);
  const [theme, setTheme] = useState("");
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const total = levels.length * skills.length * count;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Generate mock exams with AI"
      description="Each exam is written for its level: listening and reading with their questions, a writing task, and a speaking cue card — as drafts for you to read before learners see them."
      confirmLabel="Generate"
      disabled={total === 0}
      className="sm:max-w-xl"
      footerStart={
        total > 0 ? `${total} exam${total === 1 ? "" : "s"} · ${levels.length} level${levels.length === 1 ? "" : "s"} × ${skills.length} skill${skills.length === 1 ? "" : "s"}` : "Pick at least one level and skill"
      }
      onConfirm={() => onGenerate(levels, skills, count)}
    >
      <div className="grid gap-5">
        <fieldset className="grid gap-2">
          <div className="flex items-center justify-between">
            <legend className="text-body-sm font-medium">Levels</legend>
            <button
              type="button"
              className="text-caption text-primary-text hover:underline"
              onClick={() => setLevels(levels.length === cefrLevels.length ? [] : [...cefrLevels])}
            >
              {levels.length === cefrLevels.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {cefrLevels.map((code) => (
              <ToggleChip key={code} active={levels.includes(code)} onClick={() => setLevels(toggle(levels, code))}>
                {code}
              </ToggleChip>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-body-sm font-medium">Sections</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {mockSkills.map((skill) => {
              const Icon = mockSkillIcons[skill];
              return (
                <ToggleChip key={skill} active={skills.includes(skill)} onClick={() => setSkills(toggle(skills, skill))}>
                  <Icon className="size-4" aria-hidden /> {mockSkillLabels[skill]}
                </ToggleChip>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="grid gap-1.5">
            <p className="text-body-sm font-medium">Exams per level and section</p>
            <div className="flex gap-2">
              {[1, 2, 3].map((n) => (
                <ToggleChip key={n} active={count === n} onClick={() => setCount(n)} className="w-12">
                  {n}
                </ToggleChip>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mock-theme">Theme — optional</Label>
            <Input id="mock-theme" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="travel, work, the city… leave empty for a mix" />
          </div>
        </div>
      </div>
    </ConfirmDialog>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center justify-center gap-1.5 rounded-lg border text-body-sm font-medium outline-none transition-colors duration-micro focus-visible:ring-[3px] focus-visible:ring-ring/40",
        active ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

