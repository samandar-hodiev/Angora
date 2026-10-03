"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { WallpaperMask } from "@/features/profile/components/wallpaper-layer";
import { cn } from "@/lib/utils";

/**
 * A page's title card.
 *
 * `pinned` (the default) keeps it under the shell header while the page scrolls, with the
 * wallpaper band that content vanishes into. Pages that are mostly one long task — the skill
 * practice pages — pass `pinned={false}`: there the title is read once on arrival, and a card
 * holding a fifth of the screen for the whole task is in the way. `compact` is the smaller
 * size those pages use.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  pinned = true,
  compact = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  pinned?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Publishes its own height on the learning area, so what pins or clips below it — the mask
  // above the content, the settings section menu — sits exactly under it whatever the title turns
  // out to be: one line or three, with a description, at any window width or zoom.
  useEffect(() => {
    const element = ref.current;
    const main = element?.closest("main");
    // Nothing pins under a title that scrolls away, so it has no height to publish.
    if (!pinned || !element || !main) return;

    const publish = () => main.style.setProperty("--page-title-h", `${Math.round(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      main.style.removeProperty("--page-title-h");
    };
  }, [pinned]);

  return (
    <>
      {/* Covers the band this title sits in, painted over the content: cards scrolling up vanish
          into it 12px before they would reach the title. It repeats the wallpaper exactly, so the
          band still shows the picture rather than a flat bar. */}
      {pinned && <WallpaperMask />}
      <div
        ref={ref}
        // Pinned at its own natural position — the shell header plus the area's top padding — so
        // it does not travel before it sticks, and content never reaches it.
        style={pinned ? { top: "calc(var(--app-header-h, 3.5rem) + var(--main-pt, 1.5rem))" } : undefined}
        className={cn(
          "flex flex-col gap-4 rounded-xl border bg-surface sm:flex-row sm:items-end sm:justify-between",
          pinned && "sticky z-20",
          compact ? "mb-5 px-5 py-3" : "mb-6 px-5 py-3.5",
        )}
      >
        <div className={cn("grid", compact ? "gap-1" : "gap-1.5")}>
          {eyebrow && <div className="text-label text-fg-muted">{eyebrow}</div>}
          <h1 className={compact ? "text-h2" : "text-h1"}>{title}</h1>
          {description && (
            <p className={cn("max-w-2xl text-fg-secondary", compact ? "text-body-sm" : "text-body")}>{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </>
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
