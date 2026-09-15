import { CircleAlert, Inbox, Loader2, RotateCw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

// Server-safe: usable from server and client components. `onRetry` is only passed by
// client components.

function StateFrame({ className, children, role }: { className?: string; children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed bg-surface/50 px-6 py-10 text-center", className)}>
      {children}
    </div>
  );
}

function StateIcon({ icon: Icon, tone = "muted" }: { icon: LucideIcon; tone?: "muted" | "error" | "primary" }) {
  return (
    <span
      className={cn(
        "grid size-10 place-items-center rounded-full",
        tone === "muted" && "bg-surface-active text-fg-muted",
        tone === "error" && "bg-error/10 text-error",
        tone === "primary" && "bg-primary-subtle text-primary-subtle-foreground",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

/** Something failed. Explains what happened, reassures, and offers a retry. */
export function ErrorState({
  error,
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  error?: unknown;
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <StateFrame role="alert" className={className}>
      <StateIcon icon={CircleAlert} tone="error" />
      <div className="grid max-w-sm gap-1">
        <p className="text-h4">{title}</p>
        <p className="text-body-sm text-fg-secondary">{description ?? (error !== undefined ? errorMessage(error) : "Please try again.")}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          Try again
        </Button>
      )}
    </StateFrame>
  );
}

/** Nothing here yet. Always says what will make content appear. */
export function EmptyState({
  icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <StateFrame className={className}>
      <StateIcon icon={icon} tone="primary" />
      <div className="grid max-w-sm gap-1">
        <p className="text-h4">{title}</p>
        {description && <p className="text-body-sm text-fg-secondary">{description}</p>}
      </div>
      {action}
    </StateFrame>
  );
}

export function InlineLoader({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-2 text-body-sm text-fg-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
