import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    // Pinned under the shell's header, so a page's own title never scrolls out of sight — and
    // the blurred band keeps cards from showing through the type as they pass behind it.
    <div className="sticky top-14 z-20 mb-6 flex flex-col gap-4 bg-background/72 py-3 backdrop-blur-md sm:flex-row sm:items-end sm:justify-between">
      <div className="grid gap-1.5">
        {eyebrow && <div className="text-label text-fg-muted">{eyebrow}</div>}
        <h1 className="text-h1">{title}</h1>
        {description && <p className="max-w-2xl text-body text-fg-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ id, title, action }: { id?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 id={id} className="text-h3">
        {title}
      </h2>
      {action}
    </div>
  );
}
