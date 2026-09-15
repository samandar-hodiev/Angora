"use client";

import { Check } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** "02 / 04" with a segmented bar. */
export function OnboardingProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="grid gap-2.5">
      <p className="text-label text-fg-muted tabular-nums" aria-hidden>
        {String(current).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </p>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={`Step ${current} of ${total}`}
        className="flex gap-1.5"
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn("h-1 flex-1 rounded-full bg-surface-active transition-colors duration-emphasis ease-standard", i < current && "bg-primary")}
          />
        ))}
      </div>
    </div>
  );
}

export function StepHeader({ title, description, id = "step-title" }: { title: string; description?: string; id?: string }) {
  return (
    <div className="grid gap-2">
      <h1 id={id} className="text-h1 text-balance">
        {title}
      </h1>
      {description && <p className="text-body-lg text-balance text-fg-secondary">{description}</p>}
    </div>
  );
}

export function StepCard({ children, footer, labelledBy = "step-title" }: { children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className="journey-card grid gap-8 rounded-2xl px-5 py-7 sm:p-9">
      {children}
      {footer && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">{footer}</div>}
    </section>
  );
}

/** Keyboard-accessible single choice (arrow keys move between options). */
export function ChoiceGroup({
  value,
  onValueChange,
  label,
  children,
  className,
}: {
  value: string | null;
  onValueChange: (value: string) => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Root value={value ?? ""} onValueChange={onValueChange} aria-label={label} className={cn("grid gap-3", className)}>
      {children}
    </RadioGroupPrimitive.Root>
  );
}

export function ChoiceCard({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className={cn(
        "group flex w-full items-center gap-4 rounded-xl border bg-surface/50 px-4 py-3.5 text-left shadow-xs outline-none",
        "transition-[background-color,border-color,box-shadow] duration-micro ease-standard hover:border-primary/40 hover:bg-surface-hover",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary-subtle/50",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
    >
      {children}
      <span
        aria-hidden
        className="ml-auto grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-micro group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground"
      >
        <Check className="size-3 opacity-0 group-data-[state=checked]:opacity-100" strokeWidth={3} />
      </span>
    </RadioGroupPrimitive.Item>
  );
}

export function LevelCardContent({ code, name, description }: { code: string; name: string; description: string }) {
  return (
    <>
      <span className="grid size-12 shrink-0 place-items-center rounded-lg border bg-background/40 text-h3 font-semibold tracking-tight text-primary transition-colors group-data-[state=checked]:border-primary/50">
        {code}
      </span>
      <span className="grid gap-0.5">
        <span className="text-h4">{name}</span>
        <span className="text-body-sm text-fg-secondary">{description}</span>
      </span>
    </>
  );
}
