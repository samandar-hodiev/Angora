import type { ReactNode } from "react";

import { Brand } from "@/components/common/brand";
import { cn } from "@/lib/utils";

export function AuthHeader({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-4 text-center">
      <Brand />
      {icon && (
        <span className="grid size-11 place-items-center rounded-full bg-primary-subtle text-primary-subtle-foreground [&_svg]:size-5">
          {icon}
        </span>
      )}
      <div className="grid gap-1.5">
        <h1 className="text-h2 text-balance">{title}</h1>
        {description && <p className="text-body-sm text-balance text-fg-secondary">{description}</p>}
      </div>
    </div>
  );
}

/** The premium container shared by every authentication and account-setup step. */
export function AuthCard({
  title,
  description,
  icon,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5", className)}>
      <section className="journey-card grid gap-7 rounded-2xl px-5 py-7 sm:px-8 sm:py-9">
        <AuthHeader title={title} description={description} icon={icon} />
        <div className="grid gap-5">{children}</div>
      </section>
      {footer && <div className="grid justify-items-center gap-3 text-center">{footer}</div>}
    </div>
  );
}
