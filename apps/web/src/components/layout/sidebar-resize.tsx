"use client";

import {
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";

/**
 * A sidebar whose width is dragged by its right edge.
 *
 * It runs from icons only up to `max`. Narrowing it shortens the labels ("Lea…"); below
 * `collapseAt` a label has too little room to say anything, so the sidebar settles into icons
 * only. The width is remembered in this browser. The edge is also a keyboard control: ←/→ by
 * 16px (48 with Shift), Home for icons only, End for the widest; double-click resets.
 */
export interface SidebarSize {
  icons: number;
  collapseAt: number;
  initial: number;
  max: number;
}

const listeners = new Set<() => void>();
const cache = new Map<string, number>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(key: string, size: SidebarSize): number {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let value = size.initial;
  try {
    const stored = Number(window.localStorage.getItem(key));
    if (stored === size.icons) value = size.icons;
    else if (stored > 0) value = Math.min(Math.max(stored, size.collapseAt), size.max);
  } catch {
    /* storage unavailable: the default width */
  }
  cache.set(key, value);
  return value;
}

function write(key: string, value: number) {
  cache.set(key, value);
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* private mode: the width simply does not persist */
  }
  listeners.forEach((listener) => listener());
}

export function useSidebarWidth(storageKey: string, size: SidebarSize) {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(storageKey, size),
    () => size.initial,
  );
  /** While the edge is being dragged, the live width; null otherwise. */
  const [drag, setDrag] = useState<number | null>(null);

  const live = drag ?? stored;
  const collapsed = live < size.collapseAt;
  const width = collapsed ? size.icons : live;

  /** Commits a width: below the threshold it is "icons only", anything else is kept as is. */
  function settle(value: number) {
    write(storageKey, value < size.collapseAt ? size.icons : Math.round(Math.min(value, size.max)));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    // The sidebar starts at the window's left edge, so the pointer's x is the width.
    const at = (x: number) => Math.min(Math.max(x, size.icons), size.max);
    let latest = at(event.clientX);
    setDrag(latest);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (e: PointerEvent) => {
      latest = at(e.clientX);
      setDrag(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      settle(latest);
      setDrag(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    const next =
      event.key === "ArrowLeft"
        ? width - step
        : event.key === "ArrowRight"
          ? (collapsed ? size.collapseAt : width) + step
          : event.key === "Home"
            ? size.icons
            : event.key === "End"
              ? size.max
              : null;
    if (next === null) return;
    event.preventDefault();
    settle(next);
  }

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={size.icons}
      aria-valuemax={size.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => settle(size.initial)}
      // Wider than the border it sits on, so it can be found without pixel hunting, and
      // drawn only on hover, focus and drag.
      className="group/resize absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none"
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary opacity-0 transition-opacity duration-micro",
          "group-hover/resize:opacity-60 group-focus-visible/resize:opacity-100",
          drag !== null && "opacity-100",
        )}
      />
    </div>
  );

  return { width, collapsed, handle };
}
