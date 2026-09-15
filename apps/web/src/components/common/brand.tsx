import Link from "next/link";

import { cn } from "@/lib/utils";

/** The Engora mark: a four-point spark, the product's single recurring AI motif. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-5 text-primary", className)}>
      <path
        fill="currentColor"
        d="M12 1.5c.5 4.9 1.9 7.8 4.1 9.2 1.5 1 3.5 1.4 6.4 1.3-2.9-.1-4.9.3-6.4 1.3-2.2 1.4-3.6 4.3-4.1 9.2-.5-4.9-1.9-7.8-4.1-9.2-1.5-1-3.5-1.4-6.4-1.3 2.9.1 4.9-.3 6.4-1.3C10.1 9.3 11.5 6.4 12 1.5Z"
      />
    </svg>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md text-h4 tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
    >
      <BrandMark />
      <span>Engora</span>
    </Link>
  );
}
