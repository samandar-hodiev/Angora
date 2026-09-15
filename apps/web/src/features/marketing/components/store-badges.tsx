"use client";

import { Play, Smartphone } from "lucide-react";
import type { ReactNode } from "react";

import { appStoreLinks } from "@/config/app-stores";
import { cn } from "@/lib/utils";

import { useI18n } from "../i18n";

/**
 * App store entry points. Until the apps are published (links are null) they render as
 * clearly labelled "coming soon" badges rather than links. Replace with the official badge
 * artwork from Apple and Google when the store listings exist.
 */
function StoreBadge({ href, icon, small, name, comingSoon }: { href: string | null; icon: ReactNode; small: string; name: string; comingSoon: string }) {
  const content = (
    <>
      <span className="grid size-6 place-items-center text-foreground" aria-hidden>
        {icon}
      </span>
      <span className="grid text-left leading-none">
        <span className="text-[10px] text-fg-muted">{href ? small : comingSoon}</span>
        <span className="mt-0.5 text-body-sm font-semibold tracking-tight">{name}</span>
      </span>
    </>
  );
  const cls = cn(
    "glass-button inline-flex h-12 w-[9.5rem] items-center gap-2.5 rounded-lg px-3.5 transition-[border-color,box-shadow] duration-normal",
    href ? "hover:shadow-[0_10px_28px_-14px_var(--primary-glow)]" : "cursor-default",
  );

  if (!href) {
    return (
      <span className={cls} aria-label={`${name} — ${comingSoon}`} role="img">
        {content}
      </span>
    );
  }
  return (
    <a href={href} className={cn(cls, "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40")} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  );
}

export function StoreBadges() {
  const { t } = useI18n();
  return (
    <div className="grid gap-2">
      <p className="text-label text-fg-muted">{t.footer.getTheApp}</p>
      <div className="flex flex-wrap gap-2">
        <StoreBadge href={appStoreLinks.appStore} icon={<Smartphone className="size-5" />} small={t.footer.appStoreSmall} name={t.footer.appStore} comingSoon={t.footer.comingSoon} />
        <StoreBadge href={appStoreLinks.googlePlay} icon={<Play className="size-5 fill-current" />} small={t.footer.googlePlaySmall} name={t.footer.googlePlay} comingSoon={t.footer.comingSoon} />
      </div>
    </div>
  );
}
