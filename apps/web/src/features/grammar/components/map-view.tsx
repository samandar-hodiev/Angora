"use client";

import { ArrowLeft, Check, Clock, Maximize2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrammarMapNode, GrammarTopicSummary } from "@engora/types";

import { useGrammarMap } from "../hooks";

/**
 * The grammar map, drawn as a flow board.
 *
 * The whole curriculum is on one canvas, the way a flow is laid out on a whiteboard: each
 * category is a lane, its topics hang under it in curriculum order, joined by a line. Topics
 * a learner can open are green; topics still being written are shown dashed and amber —
 * waiting, not missing — so the road ahead is visible before it is paved.
 *
 * The board pans by dragging and zooms with the buttons or Ctrl/⌘ + wheel. Every ready topic
 * is still a plain link, so it is reachable with Tab and opens with Enter.
 */
export function GrammarMapView() {
  const map = useGrammarMap();
  const nodes = map.data ?? [];
  const all = nodes.flatMap((n) => n.groups.flatMap((g) => g.topics));
  const ready = all.filter((t) => !t.coming_soon).length;

  return (
    <>
      <PageHeader
        title="Grammar map"
        description="The whole curriculum on one board — what you can study now, and what is on its way."
        eyebrow={
          <Link href="/app/grammar" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Grammar
          </Link>
        }
      />

      {map.isPending ? (
        <Skeleton className="h-[70dvh] rounded-2xl" />
      ) : map.isError ? (
        <ErrorState error={map.error} onRetry={() => void map.refetch()} />
      ) : nodes.length === 0 ? (
        <EmptyState title="The map is empty" description="Grammar topics will appear here once they are added." />
      ) : (
        <Board nodes={nodes} ready={ready} total={all.length} />
      )}
    </>
  );
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;

function Board({ nodes, ready, total }: { nodes: GrammarMapNode[]; ready: number; total: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 32, y: 32 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  // Set by the pointer-up that ends a drag, read by the click that follows it.
  const dragEnded = useRef(false);

  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * factor * 100) / 100)));
  }, []);
  const reset = () => {
    setZoom(1);
    setPan({ x: 32, y: 32 });
  };

  // Ctrl/⌘ + wheel zooms (a trackpad pinch arrives as this too); a plain wheel pans, as on
  // any whiteboard. Bound natively: React's wheel listener is passive and cannot stop the
  // page from scrolling or zooming underneath.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08);
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // A few pixels of slack, so a click on a topic is still a click and not a tiny drag.
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setPan({ x: d.panX + dx, y: d.panY + dy });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-fg-secondary">
          <li className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded border border-success/70 bg-success/20" />
            Ready to study
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded border border-dashed border-warning/80 bg-warning/10" />
            Coming soon
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="grid size-3.5 place-items-center rounded-full bg-success text-success-foreground">
              <Check className="size-2.5" />
            </span>
            Mastered
          </li>
        </ul>
        <span className="text-caption text-fg-muted tabular-nums">
          {ready} of {total} topics ready
        </span>
        <div className="ml-auto flex items-center gap-1 rounded-lg border bg-surface p-0.5">
          <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.15)}>
            <Minus className="size-4" aria-hidden />
          </ZoomButton>
          <span className="w-12 text-center text-caption text-fg-secondary tabular-nums">{Math.round(zoom * 100)}%</span>
          <ZoomButton label="Zoom in" onClick={() => zoomBy(1.15)}>
            <Plus className="size-4" aria-hidden />
          </ZoomButton>
          <ZoomButton label="Reset view" onClick={reset}>
            <Maximize2 className="size-3.5" aria-hidden />
          </ZoomButton>
        </div>
      </div>

      <div
        ref={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // A click that ended a drag must not open the topic under the cursor.
        onClickCapture={(e) => {
          if (drag.current === null && dragEnded.current) {
            e.preventDefault();
            e.stopPropagation();
          }
          dragEnded.current = false;
        }}
        onPointerUpCapture={() => {
          dragEnded.current = Boolean(drag.current?.moved);
        }}
        className="relative h-[calc(100dvh-15rem)] min-h-[28rem] cursor-grab touch-none overflow-hidden rounded-2xl border bg-background select-none active:cursor-grabbing"
        style={{
          backgroundImage: "radial-gradient(color-mix(in oklch, var(--fg-muted) 35%, transparent) 1px, transparent 1px)",
          backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        aria-label="Grammar map board — drag to move, use the zoom buttons to resize"
      >
        <div
          className="absolute top-0 left-0 flex origin-top-left items-start gap-12"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {nodes.map((node) => (
            <Lane key={node.slug} node={node} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-md text-fg-secondary outline-none transition-colors duration-micro hover:bg-surface-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {children}
    </button>
  );
}

/** One category: its card on top, its topics hanging under it on one line. */
function Lane({ node }: { node: GrammarMapNode }) {
  const topics = node.groups.flatMap((g) => g.topics.map((t) => ({ topic: t, group: g.label })));
  const ready = topics.filter((t) => !t.topic.coming_soon).length;

  return (
    <section aria-labelledby={`lane-${node.slug}`} className="flex w-60 shrink-0 flex-col items-stretch">
      <header className="rounded-xl border border-primary/50 bg-primary-subtle px-4 py-3 shadow-sm">
        <h2 id={`lane-${node.slug}`} className="text-body font-semibold text-primary-subtle-foreground">
          {node.name}
        </h2>
        <p className="text-caption text-fg-secondary tabular-nums">
          {ready} of {topics.length} ready
        </p>
      </header>
      <ol className="flex flex-col">
        {topics.map(({ topic, group }, i) => {
          const showGroup = group && group !== topics[i - 1]?.group;
          return (
            <li key={topic.slug} className="flex flex-col items-stretch">
              <Connector ready={!topic.coming_soon} />
              {showGroup && (
                <>
                  <span className="self-center rounded-full border bg-surface px-2.5 py-0.5 text-[0.6875rem] font-medium tracking-wide text-fg-muted uppercase">
                    {group}
                  </span>
                  <Connector ready={!topic.coming_soon} />
                </>
              )}
              <TopicNode topic={topic} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The line between two cards: solid into a ready topic, dashed into one still coming. */
function Connector({ ready }: { ready: boolean }) {
  return (
    <span aria-hidden className="relative mx-auto h-6 w-px">
      <span className={cn("absolute inset-0 border-l-2", ready ? "border-success/50" : "border-dashed border-warning/40")} />
      <span
        className={cn(
          "absolute -bottom-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full",
          ready ? "bg-success/70" : "bg-warning/60",
        )}
      />
    </span>
  );
}

function TopicNode({ topic }: { topic: GrammarTopicSummary }) {
  if (topic.coming_soon) {
    return (
      <div
        className="rounded-xl border border-dashed border-warning/60 bg-warning/[0.06] px-3 py-2.5"
        title={`${topic.name} — being written, coming soon`}
      >
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-body-sm font-medium text-fg-secondary">{topic.name}</span>
          {topic.level && <span className="shrink-0 text-[0.6875rem] font-semibold text-fg-muted">{topic.level}</span>}
        </div>
        <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-warning-text">
          <Clock className="size-3" aria-hidden />
          Coming soon
        </p>
      </div>
    );
  }

  const mastered = topic.state === "mastered";
  const started = topic.mastery > 0;
  return (
    <Link
      href={`/app/grammar/${topic.slug}`}
      draggable={false}
      className="group block rounded-xl border border-success/60 bg-success/[0.12] px-3 py-2.5 shadow-sm outline-none transition-[background-color,box-shadow,transform] duration-micro hover:-translate-y-px hover:bg-success/[0.18] hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-body-sm font-semibold">{topic.name}</span>
        {mastered ? (
          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-success text-success-foreground" title="Mastered">
            <Check className="size-3" aria-label="Mastered" />
          </span>
        ) : (
          topic.level && <span className="shrink-0 text-[0.6875rem] font-semibold text-success">{topic.level}</span>
        )}
      </div>
      {started && !mastered ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-active">
            <span className="block h-full rounded-full bg-success" style={{ width: `${Math.round(topic.mastery)}%` }} />
          </span>
          <span className="text-[0.6875rem] text-fg-muted tabular-nums">{Math.round(topic.mastery)}%</span>
        </div>
      ) : (
        <p className="mt-1 text-[0.6875rem] text-fg-muted">{mastered ? "Mastered" : "Ready to study"}</p>
      )}
    </Link>
  );
}
