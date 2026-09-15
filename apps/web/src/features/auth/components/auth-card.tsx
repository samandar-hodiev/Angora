import type { ReactNode } from "react";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5 text-center">
        <h1 className="text-h1">{title}</h1>
        {description && <p className="text-body-sm text-fg-secondary">{description}</p>}
      </div>
      <div className="grid gap-5 rounded-xl border bg-surface p-6 shadow-sm sm:p-7">{children}</div>
      {footer && <p className="text-center text-body-sm text-fg-secondary">{footer}</p>}
    </div>
  );
}
