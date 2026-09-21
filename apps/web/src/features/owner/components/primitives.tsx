"use client";

import { ArrowDownRight, ArrowUpRight, Check, Eye, Minus, MoreHorizontal, Search, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initials,
} from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formatMetric, formatNumber, healthLabels, planLabels, statusLabels } from "../lib/format";
import type {
  ContentStatus,
  DashboardMetric,
  HealthState,
  LanguageStatus,
  LearnerStatus,
  PlanCode,
} from "../types";

/**
 * The Owner console's building blocks.
 *
 * Everything here is composed from the existing design system (components/ui/*) — no new
 * styling language. What differs from the learner app is density: smaller type, flatter
 * surfaces, less motion, and numbers that line up in columns.
 */

// ---- Layout ---------------------------------------------------------------------------------

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-surface", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="truncate text-h4">{title}</h2>
          {description && <p className="truncate text-caption text-fg-muted">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </header>
      <div className={cn("min-w-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function OwnerPageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 grid gap-3">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 && <span aria-hidden>/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="transition-colors duration-micro hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-fg-secondary">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid min-w-0 gap-1">
          <h1 className="text-h2">{title}</h1>
          {description && <p className="text-body-sm text-fg-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ---- KPI ------------------------------------------------------------------------------------

export function StatCard({
  metric,
  icon: Icon,
  emphasis = false,
}: {
  metric: DashboardMetric;
  icon?: LucideIcon;
  emphasis?: boolean;
}) {
  const delta = metric.delta;
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  const deltaTone =
    delta?.direction === "up" ? "text-success" : delta?.direction === "down" ? "text-error" : "text-fg-muted";

  return (
    <article
      className={cn(
        "grid min-w-0 gap-2 rounded-xl border bg-surface p-4",
        emphasis && "border-primary/30 bg-primary-subtle/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-label text-fg-muted">{metric.label}</h3>
        {Icon && (
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-active text-fg-muted">
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
      </div>
      <p className="text-h2 tabular-nums">{formatMetric(metric.value, metric.format)}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption">
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", deltaTone)}>
            <DeltaIcon className="size-3.5" aria-hidden />
            {delta.direction === "flat" ? "0%" : `${Math.abs(delta.percent)}%`}
            <span className="sr-only">
              {delta.direction === "up" ? "increase" : delta.direction === "down" ? "decrease" : "no change"}
            </span>
          </span>
        )}
        <span className="text-fg-muted">{delta ? delta.comparison : metric.hint}</span>
      </div>
      {delta && <p className="truncate text-caption text-fg-muted">{metric.hint}</p>}
    </article>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="grid gap-2.5 rounded-xl border bg-surface p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-20" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

// ---- Badges ----------------------------------------------------------------------------------

const statusVariants: Record<ContentStatus, string> = {
  draft: "border-transparent bg-surface-active text-fg-secondary",
  ai_generated: "border-transparent bg-info/15 text-info",
  review: "border-transparent bg-warning/20 text-warning-foreground",
  approved: "border-transparent bg-primary-subtle text-primary-subtle-foreground",
  published: "border-transparent bg-success/15 text-success",
  archived: "border-transparent bg-surface-active text-fg-muted line-through",
};

export function StatusBadge({ status, className }: { status: ContentStatus; className?: string }) {
  return <Badge className={cn(statusVariants[status], className)}>{statusLabels[status]}</Badge>;
}

const planVariants: Record<PlanCode, string> = {
  free: "border-border bg-surface text-fg-secondary",
  premium: "border-transparent bg-primary-subtle text-primary-subtle-foreground",
  unlimited: "border-transparent bg-warning/20 text-warning-foreground",
};

export function PlanBadge({ plan, className }: { plan: PlanCode; className?: string }) {
  return <Badge className={cn(planVariants[plan], className)}>{planLabels[plan]}</Badge>;
}

const learnerStatusVariants: Record<LearnerStatus, string> = {
  active: "border-transparent bg-success/15 text-success",
  suspended: "border-transparent bg-error/15 text-error",
  pending: "border-transparent bg-warning/20 text-warning-foreground",
  archived: "border-transparent bg-surface-active text-fg-muted",
};

const learnerStatusLabels: Record<LearnerStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  pending: "Pending",
  archived: "Archived",
};

export function LearnerStatusBadge({ status }: { status: LearnerStatus }) {
  return <Badge className={learnerStatusVariants[status]}>{learnerStatusLabels[status]}</Badge>;
}

export function LevelBadge({ level }: { level: string }) {
  return (
    <Badge variant="outline" className="font-mono tabular-nums">
      {level}
    </Badge>
  );
}

const languageDots: Record<LanguageStatus, string> = {
  published: "bg-success",
  draft: "bg-warning",
  missing: "bg-surface-active",
};

/** UZ / EN / RU at a glance: a filled dot per language, with the state in the label. */
export function LanguagePills({ languages }: { languages: Record<string, LanguageStatus> }) {
  return (
    <ul className="flex items-center gap-1">
      {Object.entries(languages).map(([language, status]) => (
        <li key={language}>
          <span
            title={`${language.toUpperCase()}: ${status}`}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase",
              status === "missing" ? "text-fg-disabled" : "text-fg-secondary",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", languageDots[status])} />
            {language}
            <span className="sr-only">: {status}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const healthTones: Record<HealthState, string> = {
  operational: "bg-success",
  degraded: "bg-warning",
  attention: "bg-warning",
  down: "bg-error",
};

export function HealthDot({ state }: { state: HealthState }) {
  return (
    <span className="inline-flex items-center gap-2 text-body-sm">
      <span aria-hidden className={cn("size-2 rounded-full", healthTones[state])} />
      <span className="sr-only">Status: </span>
      {healthLabels[state]}
    </span>
  );
}

// ---- Filters ---------------------------------------------------------------------------------

/**
 * A search box built for a server-side search later: it reports the debounced value, so
 * swapping the mock service for an endpoint changes nothing above it.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  label,
  delay = 250,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  delay?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // The parent can reset the query (a "clear filters" button); follow it without an effect.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  // Debounced hand-off. The parent receives a settled value, which is exactly what a
  // server-side search endpoint will want.
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChangeRef.current(draft), delay);
    return () => clearTimeout(timer);
  }, [draft, delay, value]);

  return (
    <div className={cn("relative min-w-0 flex-1 basis-56 sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
      <Input
        type="search"
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft("");
            onChangeRef.current("");
          }
        }}
        className="h-9 pr-9 pl-9"
      />
      {draft && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft("");
            onChangeRef.current("");
          }}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-fg-muted transition-colors duration-micro hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1", className)}>
      <span className="sr-only">{label}</span>
      <NativeSelect
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-9 min-w-32 text-body-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

export function FilterBar({
  children,
  onReset,
  resultLabel,
}: {
  children: ReactNode;
  onReset?: () => void;
  resultLabel?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-surface p-3">
      {children}
      <div className="ml-auto flex items-center gap-2">
        {resultLabel && <span className="text-caption text-fg-muted tabular-nums">{resultLabel}</span>}
        {onReset && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

/** The segmented control used for plan and date-range filters. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "default",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; dotColor?: string }[];
  onChange: (value: T) => void;
  size?: "default" | "sm";
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border bg-surface p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 font-medium transition-colors duration-micro",
              "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              size === "sm" ? "h-7 text-caption" : "h-8 text-body-sm",
              active ? "bg-primary text-primary-foreground shadow-xs" : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {option.dotColor && (
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: active ? "currentColor" : option.dotColor }}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Actions ----------------------------------------------------------------------------------

export interface ActionItem {
  label: string;
  icon?: LucideIcon;
  href?: string;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function ActionMenu({ label, items, align = "end" }: { label: string; items: ActionItem[]; align?: "start" | "end" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={label} size="icon-sm">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {items.map((item, index) => (
          <div key={item.label}>
            {item.separatorBefore && index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={item.disabled}
              onSelect={item.onSelect}
              asChild={Boolean(item.href)}
              className={cn(item.destructive && "text-error [&_svg]:text-error")}
            >
              {item.href ? (
                <Link href={item.href}>
                  {item.icon && <item.icon aria-hidden />}
                  {item.label}
                </Link>
              ) : (
                <>
                  {item.icon && <item.icon aria-hidden />}
                  {item.label}
                </>
              )}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
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
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Learner avatar ------------------------------------------------------------------------------

/**
 * A learner's avatar with a magnifier on hover/focus. The enlarged view shows the photo and the
 * name only — the Owner opening a picture has no reason to see contact details with it.
 */
export function LearnerAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl: string | null;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View ${name}'s photo`}
        className="group relative shrink-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <Avatar className={size === "sm" ? "size-8" : "size-9"}>
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center rounded-full bg-foreground/55 text-background opacity-0 transition-opacity duration-micro group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Eye className="size-3.5" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>Profile photo</DialogDescription>
          </DialogHeader>
          <div className="grid place-items-center py-2">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- mock avatars are absolute URLs
              <img src={avatarUrl} alt={`${name}'s profile photo`} className="size-48 rounded-xl border object-cover" />
            ) : (
              <div className="grid size-48 place-items-center rounded-xl border bg-surface-active">
                <span className="text-display text-fg-muted">{initials(name)}</span>
                <p className="mt-2 text-caption text-fg-muted">No photo uploaded</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---- Misc -----------------------------------------------------------------------------------

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b py-2.5 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-3">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-body-sm">{children}</dd>
    </div>
  );
}

export function CountPill({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "success" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption tabular-nums",
        tone === "success" && "bg-success/12 text-success",
        tone === "warning" && "bg-warning/18 text-warning-foreground",
        tone === "muted" && "bg-surface-active text-fg-secondary",
      )}
    >
      <span className="font-medium">{formatNumber(value)}</span>
      {label}
    </span>
  );
}

export function SavedTick({ saved }: { saved: boolean }) {
  if (!saved) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 text-caption text-success">
      <Check className="size-3.5" aria-hidden />
      Saved
    </span>
  );
}

/** The console's own loading frame, used by route Suspense boundaries. */
export function OwnerLoading() {
  return (
    <div className="grid gap-4" role="status" aria-label="Loading">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
