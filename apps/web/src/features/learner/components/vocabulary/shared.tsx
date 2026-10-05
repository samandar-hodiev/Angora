"use client";

import { Volume2 } from "lucide-react";

import { FlagRU, FlagUZ } from "@/components/common/flags";
import { cn } from "@/lib/utils";
import type { LibraryWord, VocabularyLevelText } from "@engora/types";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const LEVEL_NAMES: Record<string, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper-intermediate",
  C1: "Advanced",
  C2: "Proficient",
};

export type Accent = "en-GB" | "en-US" | "ru-RU";

/**
 * Says text aloud with the browser's own voices — British or American English, or Russian for
 * the translation. Slow is for a word the learner is trying to catch.
 */
export function speak(text: string, lang: Accent = "en-GB", slow = false) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = slow ? 0.6 : 0.9;
  const voice = synth.getVoices().find((v) => v.lang.replace("_", "-") === lang);
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

/** A small "play" button for a word or a sentence. */
export function SpeakButton({
  text,
  lang = "en-GB",
  label,
  slow,
  className,
  children,
}: {
  text: string;
  lang?: Accent;
  label?: string;
  slow?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        speak(text, lang, slow);
      }}
      aria-label={label ?? `Listen to “${text}”`}
      title={label ?? "Listen"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md text-fg-muted outline-none transition-colors duration-micro",
        "hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40",
        children ? "border px-2 py-1 text-caption hover:border-primary/40" : "p-1",
        className,
      )}
    >
      <Volume2 className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}

/** The word in Uzbek and Russian, each by its flag, with how the Russian is said. */
export function Translations({
  translations,
  className,
}: {
  translations: { uz?: string; ru?: string; ru_pron?: string };
  className?: string;
}) {
  if (!translations.uz && !translations.ru) return null;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1", className)}>
      {translations.uz && (
        <span className="flex min-w-0 items-center gap-1.5">
          <FlagUZ title="O'zbekcha" />
          <span className="font-medium">{translations.uz}</span>
        </span>
      )}
      {translations.ru && (
        <span className="grid min-w-0 gap-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <FlagRU title="Русский" />
            <span className="font-medium">{translations.ru}</span>
          </span>
          {translations.ru_pron && <span className="pl-[1.5rem] text-[0.6875rem] text-fg-muted">[{translations.ru_pron}]</span>}
        </span>
      )}
    </span>
  );
}

/** The explanation at the level asked for, or the nearest one written — lower first. */
export function explanationAt(
  content: LibraryWord["level_content"],
  level: string,
): { level: string; text: VocabularyLevelText } | null {
  const at = Math.max(0, LEVELS.indexOf(level as (typeof LEVELS)[number]));
  for (let d = 0; d < LEVELS.length; d++) {
    for (const i of d === 0 ? [at] : [at - d, at + d]) {
      const code = LEVELS[i];
      const text = code ? content[code] : undefined;
      if (text?.definition) return { level: code!, text };
    }
  }
  return null;
}

/** A word's own difficulty, as a small coloured tag. */
export function LevelTag({ level, className }: { level: string | null; className?: string }) {
  if (!level) return null;
  const tone = level.startsWith("A")
    ? "bg-success/15 text-success"
    : level.startsWith("B")
      ? "bg-primary-subtle text-primary-subtle-foreground"
      : "bg-warning/15 text-warning-text";
  return (
    <span
      className={cn("inline-flex shrink-0 rounded px-1.5 py-px text-[0.6875rem] font-semibold", tone, className)}
      title={LEVEL_NAMES[level]}
    >
      {level}
    </span>
  );
}

const DECK_LABEL: Record<string, string> = {
  new: "New",
  learning: "Learning",
  reviewing: "Reviewing",
  mastered: "Mastered",
};

/** Where a word stands in the learner's deck. */
export function DeckBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[0.6875rem] font-medium",
        status === "mastered" ? "bg-success/15 text-success" : "bg-surface-active text-fg-secondary",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "mastered" ? "bg-success" : status === "new" ? "bg-fg-muted" : "bg-primary",
        )}
      />
      {DECK_LABEL[status] ?? status}
    </span>
  );
}

/** A segmented row of buttons, used for every filter on the page. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-1 overflow-x-auto rounded-xl border bg-surface p-1", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex min-w-12 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-label whitespace-nowrap outline-none transition-colors duration-micro",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40",
            value === o.value ? "bg-primary-subtle text-primary-subtle-foreground" : "text-fg-secondary hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A pill that can be pressed: a topic, a collocation, a related word. */
export function Chip({
  children,
  active,
  onClick,
  className,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      aria-pressed={onClick && active !== undefined ? active : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-body-sm outline-none transition-colors duration-micro",
        onClick && "hover:border-primary/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
        active ? "border-primary/60 bg-primary-subtle text-primary-subtle-foreground" : "bg-surface text-fg-secondary",
        className,
      )}
    >
      {children}
    </Comp>
  );
}
