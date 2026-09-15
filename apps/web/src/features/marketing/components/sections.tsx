import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export { FAQList } from "./faq-accordion";
export { FinalCTA } from "./final-cta";

export function Section({
  id,
  children,
  className,
  tone = "default",
  labelledBy,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: "default" | "muted";
  labelledBy?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("relative scroll-mt-24", tone === "muted" && "border-y border-(--glass-border) bg-surface/30")}
    >
      <div className={cn("mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24", className)}>{children}</div>
    </section>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn("mb-12 grid max-w-2xl gap-3", align === "center" && "mx-auto justify-items-center text-center", className)}>
      {eyebrow && (
        <p className="inline-flex w-fit items-center gap-2 text-label text-primary">
          <span aria-hidden className="size-1.5 rounded-full bg-primary shadow-[0_0_10px_0_var(--primary-glow)]" />
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="text-h1 text-balance">
        {title}
      </h2>
      {description && <p className="text-body-lg text-pretty text-fg-secondary">{description}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 pt-20 pb-12 text-center sm:px-6 sm:pt-28">
      {eyebrow && <p className="text-label text-primary">{eyebrow}</p>}
      <h1 className="text-display text-balance">{title}</h1>
      <p className="text-body-lg text-pretty text-fg-secondary">{description}</p>
      {actions && <div className="flex flex-wrap justify-center gap-3 pt-2">{actions}</div>}
    </div>
  );
}
