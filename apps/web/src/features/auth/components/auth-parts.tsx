import Link from "next/link";

import { cn } from "@/lib/utils";

export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-caption text-fg-muted">
      <span className="h-px flex-1 bg-border" aria-hidden />
      {label}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

const linkClass = "underline underline-offset-4 transition-colors hover:text-foreground";

/** Terms and Privacy Policy stay reachable on every authentication and setup step. */
export function PrivacyLinks({ className }: { className?: string }) {
  return (
    <p className={cn("max-w-xs text-caption text-balance text-fg-muted", className)}>
      By continuing, you agree to our{" "}
      <Link href="/terms" className={linkClass}>
        Terms
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className={linkClass}>
        Privacy Policy
      </Link>
      .
    </p>
  );
}

export function AuthSwitch({ question, href, action }: { question: string; href: string; action: string }) {
  return (
    <p className="text-body-sm text-fg-secondary">
      {question}{" "}
      <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
        {action}
      </Link>
    </p>
  );
}
