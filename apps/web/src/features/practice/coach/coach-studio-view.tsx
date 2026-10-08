"use client";

import {
  ArrowLeft,
  Award,
  BookOpen,
  Briefcase,
  Captions,
  CaptionsOff,
  Check,
  Cpu,
  GraduationCap,
  Home,
  Lightbulb,
  MessageCircle,
  Mic,
  Pause,
  PhoneOff,
  Plane,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Square,
  UtensilsCrossed,
  ScanFace,
  Volume2,
  VolumeX,
  Lock,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/hooks";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

import { useSpeakingTasks } from "../hooks";
import { Coach3D, type CoachSpeech, type CoachState, type CoachView } from "./coach-3d";
import {
  DEMO_TOPICS,
  FEEDBACK_LANGS,
  MODES,
  PERSONAS,
  PREVIEW_SCORES,
  buildScript,
  canUseCoach,
  type CoachMode,
  type FeedbackLang,
  type CoachPersona,
  type CoachTopic,
} from "./coach-config";
import { CHAR_MS, useCoachPreview, type CoachSession } from "./use-coach-preview";

/**
 * The realtime speaking coach: pick who you talk to, pick what about, and talk.
 *
 * The coach is a full-body 3D person (coach-3d) who talks with lip-sync, brows, eye contact
 * and gestures. The conversation itself is still scripted (see use-coach-preview)
 * and the stage says "Preview" so nobody reads the feedback as real. The topics are real:
 * they are the speaking tasks the owner has published, with a demo set when there are none.
 */
export function CoachStudioView() {
  const tasks = useSpeakingTasks();
  const [phase, setPhase] = useState<"lobby" | "session" | "summary">("lobby");
  const [persona, setPersona] = useState<CoachPersona>(PERSONAS[0]!);
  const [settings, setSettings] = useState<CoachSettings>({ view: "upper", mood: "happy", voice: true, lang: "en" });
  const [mode, setMode] = useState<CoachMode>("free");
  const [topic, setTopic] = useState<CoachTopic | null>(null);
  const [run, setRun] = useState(0);

  const topics = useMemo<CoachTopic[]>(() => {
    const items = tasks.data?.items ?? [];
    if (items.length === 0) return DEMO_TOPICS;
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      level: item.level,
      topic: (item as { topic?: string | null }).topic ?? null,
    }));
  }, [tasks.data]);

  const coach = persona;

  return (
    <>
      <PageHeader
        pinned={false}
        compact
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-caption font-medium text-primary-text">
            <span className="relative flex size-2">
              <span className="coach-pulse absolute inset-0 rounded-full bg-primary" />
              <span className="relative size-2 rounded-full bg-primary" />
            </span>
            Realtime
          </span>
        }
        title="Speaking coach"
        description="Talk out loud with a coach who listens, asks follow-ups and corrects you while the sentence is still fresh."
        actions={
          phase !== "lobby" ? (
            <Button variant="outline" onClick={() => setPhase("lobby")}>
              <ArrowLeft aria-hidden />
              Topics
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/app/speaking?mode=record">
                <Mic aria-hidden />
                Record a single answer
              </Link>
            </Button>
          )
        }
      />

      {phase === "lobby" && (
        <Lobby
          coach={coach}
          settings={settings}
          onSettings={setSettings}
          onPersona={setPersona}
          mode={mode}
          onMode={setMode}
          topics={topics}
          topicsLoading={tasks.isPending}
          demoTopics={!tasks.isPending && (tasks.data?.items.length ?? 0) === 0}
          topic={topic}
          onTopic={setTopic}
          onStart={() => {
            setRun((r) => r + 1);
            setPhase("session");
          }}
        />
      )}

      {phase === "session" && (
        <Session
          key={run}
          coach={coach}
          settings={settings}
          onSettings={setSettings}
          topic={topic}
          mode={mode}
          onFinish={() => setPhase("summary")}
        />
      )}

      {phase === "summary" && (
        <Summary
          coach={coach}
          topic={topic}
          onAgain={() => {
            setRun((r) => r + 1);
            setPhase("session");
          }}
          onLobby={() => setPhase("lobby")}
        />
      )}
    </>
  );
}

// ---- Lobby ------------------------------------------------------------------------------------

const TOPIC_ICONS: Record<string, LucideIcon> = {
  education: GraduationCap,
  work: Briefcase,
  travel: Plane,
  "daily-life": Home,
  technology: Cpu,
  food: UtensilsCrossed,
  books: BookOpen,
};

const TOPIC_TINTS = [
  "from-emerald-400/25 to-teal-500/5",
  "from-sky-400/25 to-indigo-500/5",
  "from-amber-400/25 to-orange-500/5",
  "from-fuchsia-400/25 to-violet-500/5",
  "from-rose-400/25 to-pink-500/5",
  "from-lime-400/25 to-emerald-500/5",
];

export interface CoachSettings {
  view: CoachView;
  mood: "neutral" | "happy";
  voice: boolean;
  /** The language corrections and explanations come in. Questions stay in English. */
  lang: FeedbackLang;
}

function Lobby({
  coach,
  settings,
  onSettings,
  onPersona,
  mode,
  onMode,
  topics,
  topicsLoading,
  demoTopics,
  topic,
  onTopic,
  onStart,
}: {
  coach: CoachPersona;
  settings: CoachSettings;
  onSettings: (s: CoachSettings) => void;
  onPersona: (p: CoachPersona) => void;
  mode: CoachMode;
  onMode: (m: CoachMode) => void;
  topics: CoachTopic[];
  topicsLoading: boolean;
  demoTopics: boolean;
  topic: CoachTopic | null;
  onTopic: (t: CoachTopic | null) => void;
  onStart: () => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const levels = useMemo(() => ["all", ...Array.from(new Set(topics.map((t) => t.level).filter(Boolean) as string[])).sort()], [topics]);
  const shown = topics.filter(
    (t) => (level === "all" || t.level === level) && t.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:items-start">
      <CoachPicker coach={coach} settings={settings} onSettings={onSettings} onPersona={onPersona} />

      <div className="grid min-w-0 gap-6">
        <section className="grid gap-3">
          <h2 className="text-h4">How do you want to practise?</h2>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            {MODES.map((m) => {
              const active = m.value === mode;
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onMode(m.value)}
                  className={cn(
                    "grid gap-1 rounded-xl border bg-surface p-3.5 text-left transition-all duration-micro outline-none",
                    "hover:border-primary/40 hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    active && "border-primary bg-primary-subtle/50 ring-1 ring-primary",
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-body-sm font-semibold">
                    {m.label}
                    {active && <Check className="size-4 text-primary" aria-hidden />}
                  </span>
                  <span className="text-caption text-fg-muted">{m.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-0.5">
              <h2 className="text-h4">Pick a topic</h2>
              <p className="text-caption text-fg-muted">
                {demoTopics ? "Sample topics — published speaking topics will show up here." : "Your coach builds the questions around it."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-lg border bg-surface px-3 text-body-sm focus-within:ring-[3px] focus-within:ring-ring/40">
                <Search className="size-4 text-fg-muted" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search topics"
                  className="w-40 bg-transparent outline-none placeholder:text-fg-muted"
                  aria-label="Search topics"
                />
              </label>
              <div role="group" aria-label="Level" className="inline-flex rounded-lg border bg-surface p-0.5 text-caption">
                {levels.map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={level === l}
                    onClick={() => setLevel(l)}
                    className={cn(
                      "h-8 rounded-md px-2.5 font-medium transition-colors duration-micro",
                      level === l ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-hover",
                    )}
                  >
                    {l === "all" ? "All" : l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {topicsLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              <TopicCard
                title="Free conversation"
                meta="No fixed topic"
                icon={Shuffle}
                tint="from-primary/30 to-primary/0"
                active={topic === null}
                onClick={() => onTopic(null)}
              />
              {shown.map((t, i) => (
                <TopicCard
                  key={t.id}
                  title={t.title}
                  meta={t.topic ? t.topic.replace(/-/g, " ") : "Speaking topic"}
                  level={t.level}
                  icon={TOPIC_ICONS[t.topic ?? ""] ?? MessageCircle}
                  tint={TOPIC_TINTS[i % TOPIC_TINTS.length]!}
                  active={topic?.id === t.id}
                  onClick={() => onTopic(t)}
                />
              ))}
              {shown.length === 0 && (
                <p className="col-span-full rounded-xl border border-dashed p-6 text-center text-body-sm text-fg-muted">
                  No topic matches that search.
                </p>
              )}
            </div>
          )}
        </section>

        {/* The start bar stays in reach however far the topic list scrolls. */}
        <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center">
          <div className="glass-panel pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border p-2 pl-2.5 shadow-lg">
            <CoachBadge persona={coach} className="size-11 rounded-xl" />
            <div className="grid min-w-0 flex-1">
              <span className="truncate text-body-sm font-semibold">
                {coach.name} · {MODES.find((m) => m.value === mode)?.label}
              </span>
              <span className="truncate text-caption text-fg-muted">{topic ? topic.title : "Free conversation"}</span>
            </div>
            <Button variant="liquid" size="lg" onClick={onStart} className="shrink-0 rounded-xl">
              <Mic aria-hidden />
              Start talking
            </Button>
          </div>
        </div>
      </div>

    </div>
  );
}

function TopicCard({
  title,
  meta,
  level,
  icon: Icon,
  tint,
  active,
  onClick,
}: {
  title: string;
  meta: string;
  level?: string | null;
  icon: LucideIcon;
  tint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "group relative grid min-h-28 gap-3 overflow-hidden rounded-xl border bg-surface p-4 text-left outline-none transition-all duration-normal",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40",
        active && "border-primary ring-1 ring-primary",
      )}
    >
      <span aria-hidden className={cn("pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-gradient-to-br blur-xl", tint)} />
      <span className="relative flex items-start justify-between gap-2">
        <span className="grid size-9 place-items-center rounded-lg border bg-surface-elevated">
          <Icon className="size-4 text-primary" aria-hidden />
        </span>
        {active ? (
          <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3.5" aria-hidden />
          </span>
        ) : (
          level && <Badge variant="outline">{level}</Badge>
        )}
      </span>
      <span className="relative grid gap-0.5">
        <span className="text-body-sm font-semibold leading-snug">{title}</span>
        <span className="text-caption capitalize text-fg-muted">{meta}</span>
      </span>
    </button>
  );
}

function CoachPicker({
  coach,
  settings,
  onSettings,
  onPersona,
}: {
  coach: CoachPersona;
  settings: CoachSettings;
  onSettings: (s: CoachSettings) => void;
  onPersona: (p: CoachPersona) => void;
}) {
  const [greeting, setGreeting] = useState<CoachSpeech | null>(null);
  const email = useSession().user?.email;
  // The models this account can switch to, so they can download while the first coach shows.
  const preload = useMemo(
    () =>
      PERSONAS.filter((p) => canUseCoach(p, email, env.coachTesters)).flatMap((p) =>
        p.renderer.kind === "3d" ? [p.renderer.model] : [],
      ),
    [email],
  );

  useEffect(() => {
    if (!greeting) return;
    const handle = window.setTimeout(() => setGreeting(null), greeting.text.length * CHAR_MS + 600);
    return () => window.clearTimeout(handle);
  }, [greeting]);

  return (
    <section className="grid gap-4 rounded-2xl border bg-surface p-4 xl:sticky xl:top-4">
      <StageFrame state={greeting ? "speaking" : "idle"} className="h-[26rem]">
        <CoachFigure
          persona={coach}
          view={settings.view}
          mood={settings.mood}
          voice={settings.voice}
          state={greeting ? "speaking" : "idle"}
          speech={greeting}
          preload={preload}
        />
        <div className="pointer-events-none absolute left-3 top-3 grid gap-0.5 text-white">
          <span className="text-h4">{coach.name}</span>
          <span className="text-caption text-white/70">
            {coach.accent} accent · {coach.vibe}
          </span>
        </div>
        {greeting && (
          <p className="absolute inset-x-3 bottom-3 rounded-xl bg-black/55 px-3 py-2 text-center text-body-sm text-white backdrop-blur">
            {greeting.text}
          </p>
        )}
        <button
          type="button"
          disabled={coach.renderer.kind !== "3d"}
          onClick={() =>
            setGreeting({
              id: `hi-${Date.now()}`,
              text: `Hi! I'm ${coach.name}. Pick a topic and let's have a chat.`,
              msPerChar: CHAR_MS,
            })
          }
          className="absolute right-3 top-3 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-caption font-medium text-white backdrop-blur transition-colors hover:bg-white/20 disabled:opacity-40"
        >
          <Volume2 className="size-3.5" aria-hidden />
          Say hi
        </button>
      </StageFrame>

      <div className="grid gap-2">
        <span className="text-label text-fg-muted">Choose your coach</span>
        <div className="grid grid-cols-4 gap-2">
          {PERSONAS.map((p) => {
            const active = p.id === coach.id;
            const soon = !canUseCoach(p, email, env.coachTesters);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                disabled={soon}
                onClick={() => onPersona(p)}
                className={cn(
                  "relative grid justify-items-center gap-1 rounded-xl border p-1.5 pb-2 text-caption outline-none transition-all duration-micro",
                  "hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                  active && "border-primary bg-primary-subtle/40",
                )}
              >
                <CoachBadge persona={p} className={cn("size-12 rounded-lg", soon && "opacity-50")} />
                <span className={cn("font-medium", soon && "text-fg-muted")}>{p.name}</span>
                {soon && (
                  <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-surface-active">
                    <Lock className="size-2.5 text-fg-muted" aria-hidden />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-caption text-fg-muted">More coaches — different faces, voices and accents — are on the way.</p>
      </div>

      <div className="grid gap-3 rounded-xl border bg-surface-elevated/50 p-3">
        <span className="flex items-center gap-1.5 text-label text-fg-muted">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          Make it yours
        </span>
        <Row label="Feedback in">
          <Pills
            value={settings.lang}
            options={FEEDBACK_LANGS.map((l) => ({ value: l.value, label: `${l.flag} ${l.label}` }))}
            onChange={(lang) => onSettings({ ...settings, lang })}
          />
        </Row>
        <Row label="View">
          <Pills
            value={settings.view}
            options={[
              { value: "full", label: "Full body" },
              { value: "upper", label: "Upper body" },
              { value: "head", label: "Face" },
            ]}
            onChange={(view) => onSettings({ ...settings, view })}
          />
        </Row>
        <Row label="Mood">
          <Pills
            value={settings.mood}
            options={[
              { value: "happy", label: "Cheerful" },
              { value: "neutral", label: "Calm" },
            ]}
            onChange={(mood) => onSettings({ ...settings, mood })}
          />
        </Row>
        <Row label="Voice">
          <button
            type="button"
            role="switch"
            aria-checked={settings.voice}
            aria-label="Voice"
            onClick={() => onSettings({ ...settings, voice: !settings.voice })}
            className={cn("relative h-6 w-11 rounded-full transition-colors duration-micro", settings.voice ? "bg-primary" : "bg-surface-active")}
          >
            <span
              className={cn(
                "absolute left-0 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-micro",
                settings.voice ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
        </Row>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body-sm text-fg-secondary">{label}</span>
      {children}
    </div>
  );
}

function Pills<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    // The size sits on the group: tailwind-merge reads `text-caption` as a colour and would drop
    // it next to the active button's text colour.
    <div className="inline-flex rounded-lg border bg-surface p-0.5 text-caption">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-md px-2.5 font-medium transition-colors duration-micro",
            o.value === value ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-hover",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const BADGE_TINTS: Record<string, string> = {
  emma: "from-emerald-400 to-teal-600",
  daniel: "from-sky-400 to-indigo-600",
  sofia: "from-amber-400 to-orange-600",
  mia: "from-fuchsia-400 to-violet-600",
};

/** A coach's small mark — for lists, the chat and the start bar, where a 3D scene is too much. */
function CoachBadge({ persona, className }: { persona: CoachPersona; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-gradient-to-br font-semibold shadow-inner",
        BADGE_TINTS[persona.id] ?? "from-slate-500 to-slate-700",
        className,
      )}
    >
      {/* The colour lives here so a size class passed in (text-caption) is not merged away. */}
      <span className="text-white">{persona.name.charAt(0)}</span>
    </span>
  );
}

/** Picks the renderer the persona asks for. A video avatar slots in here later. */
function CoachFigure({
  persona,
  view,
  mood,
  voice,
  state,
  speech,
  gesture,
  preload,
}: {
  persona: CoachPersona;
  view: CoachView;
  mood: "neutral" | "happy";
  voice: boolean;
  state: CoachState;
  speech: CoachSpeech | null;
  gesture?: { id: string; name: string } | null;
  preload?: string[];
}) {
  if (persona.renderer.kind === "3d") {
    return (
      <Coach3D
        model={persona.renderer.model}
        body={persona.renderer.body}
        view={view}
        mood={mood}
        voice={voice}
        voiceLang={persona.voiceLang}
        state={state}
        speech={speech}
        gesture={gesture}
        preload={preload}
        className="absolute inset-0"
      />
    );
  }
  return (
    <div className="absolute inset-0 grid place-items-center text-center text-body-sm text-white/60">
      {persona.name}&apos;s video avatar is not connected yet.
    </div>
  );
}

// ---- The stage ------------------------------------------------------------------------------

const STAGE_GLOW: Record<CoachState, string> = {
  idle: "oklch(0.7 0.15 162 / 0.35)",
  speaking: "oklch(0.72 0.17 162 / 0.6)",
  listening: "oklch(0.7 0.15 235 / 0.6)",
  thinking: "oklch(0.68 0.17 295 / 0.55)",
};

/**
 * The dark studio the coach sits in. It stays dark in the light theme on purpose — it is a
 * call, and a call is a lit person in front of a dark room. The glow behind them follows
 * who is talking and how loudly, through a CSS variable set outside React's render.
 */
function StageFrame({ state, className, children }: { state: CoachState; className?: string; children: ReactNode }) {
  const glow = useRef<HTMLDivElement>(null);
  const active = state === "speaking" || state === "listening";

  useEffect(() => {
    const node = glow.current;
    if (!node) return;
    if (!active) {
      node.style.setProperty("--lvl", "0");
      return;
    }
    let frame = 0;
    let level = 0;
    const tick = (time: number) => {
      const target = 0.35 + 0.35 * Math.sin(time / 170) * Math.sin(time / 410) + Math.random() * 0.3;
      level += (target - level) * 0.18;
      node.style.setProperty("--lvl", level.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div
      ref={glow}
      className={cn(
        "relative isolate overflow-hidden rounded-2xl bg-[radial-gradient(120%_90%_at_50%_0%,#1b2b33_0%,#0c1217_55%,#06090c_100%)]",
        className,
      )}
      style={{ ["--glow" as string]: STAGE_GLOW[state] }}
    >
      {/* floor light */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-[22%] -z-10 mx-auto size-[26rem] max-w-full rounded-full blur-3xl transition-[background] duration-700"
        style={{ background: "var(--glow)", transform: "scale(calc(0.9 + var(--lvl, 0) * 0.35))" }}
      />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(transparent_0,transparent_calc(100%-1px),rgba(255,255,255,0.04)_100%)] bg-[length:100%_28px]" />
      {children}
    </div>
  );
}

function Waveform({ active, tone }: { active: boolean; tone: "coach" | "you" }) {
  return (
    <span aria-hidden className="flex h-6 items-center gap-[3px]">
      {[0.5, 0.9, 0.65, 1, 0.7, 0.85, 0.45].map((k, i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full transition-[height] duration-75", tone === "you" ? "bg-sky-300" : "bg-emerald-300")}
          style={{ height: active ? `calc(4px + var(--lvl, 0) * ${18 * k}px)` : "4px" }}
        />
      ))}
    </span>
  );
}

// ---- Session --------------------------------------------------------------------------------

function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Session({
  coach,
  settings,
  onSettings,
  topic,
  mode,
  onFinish,
}: {
  coach: CoachPersona;
  settings: CoachSettings;
  onSettings: (s: CoachSettings) => void;
  topic: CoachTopic | null;
  mode: CoachMode;
  onFinish: () => void;
}) {
  const script = useMemo(() => buildScript(topic, coach, mode), [topic, coach, mode]);
  const session = useCoachPreview(script, settings.lang);
  const langMeta = FEEDBACK_LANGS.find((l) => l.value === settings.lang) ?? FEEDBACK_LANGS[0]!;
  const [captions, setCaptions] = useState(true);
  // The hint belongs to one question: moving on closes it.
  const [hintFor, setHintFor] = useState<number | null>(null);

  useEffect(() => {
    if (session.finished) onFinish();
  }, [session.finished, onFinish]);

  const hint = hintFor === session.index;

  const saying = session.stage === "coach" || session.stage === "feedback";

  // The line the coach is saying now — a question in English, or the correction in the
  // feedback language. Pausing stops it; the next line starts fresh.
  const speech = useMemo<CoachSpeech | null>(
    () =>
      saying && !session.paused && session.line
        ? {
            id: `${session.stage}-${session.index}`,
            text: session.line,
            msPerChar: CHAR_MS,
            lang: session.stage === "feedback" && settings.lang !== "en" ? langMeta.voice : undefined,
          }
        : null,
    [saying, session.paused, session.line, session.stage, session.index, settings.lang, langMeta.voice],
  );

  // A thumbs-up while praising a good answer — the kind of thing a person does.
  const gesture = useMemo(
    () =>
      session.stage === "feedback" && session.turn?.feedback.tone === "good"
        ? { id: `good-${session.index}`, name: "thumbup" }
        : null,
    [session.stage, session.turn, session.index],
  );

  const avatarState: CoachState = session.paused
    ? "idle"
    : saying
      ? "speaking"
      : session.stage === "listening"
        ? "listening"
        : session.stage === "thinking"
          ? "thinking"
          : "idle";

  const status = {
    coach: { label: `${coach.name} is speaking`, dot: "bg-emerald-400" },
    "your-turn": { label: "Your turn — tap the mic", dot: "bg-amber-300" },
    listening: { label: "Listening…", dot: "bg-sky-400" },
    thinking: { label: `${coach.name} is thinking`, dot: "bg-violet-400" },
    feedback: { label: `${coach.name} is giving feedback`, dot: "bg-amber-400" },
  }[session.stage];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
      <div className="grid gap-3">
        <StageFrame state={avatarState} className="h-[min(68vh,40rem)] min-h-[26rem]">
          <CoachFigure
            persona={coach}
            view={settings.view}
            mood={settings.mood}
            voice={settings.voice}
            state={avatarState}
            speech={speech}
            gesture={gesture}
          />

          {/* top bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 text-white">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/10 px-3 text-caption font-medium backdrop-blur">
                <MessageCircle className="size-3.5" aria-hidden />
                <span className="max-w-[16rem] truncate">{topic?.title ?? "Free conversation"}</span>
              </span>
              <span className="inline-flex h-7 items-center rounded-full bg-white/10 px-3 text-caption backdrop-blur">
                Question {session.index + 1} of {session.total}
              </span>
              <span className="inline-flex h-7 items-center gap-1 rounded-full bg-white/10 px-2.5 text-caption backdrop-blur" title="Feedback language">
                <span aria-hidden>{langMeta.flag}</span>
                {langMeta.label}
              </span>
              <span className="inline-flex h-7 items-center rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 text-caption font-medium text-amber-200">
                Preview
              </span>
            </div>
            <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-black/40 px-3 text-caption tabular-nums backdrop-blur">
              <span className={cn("size-1.5 rounded-full", session.paused ? "bg-white/50" : "bg-red-500")} />
              {formatClock(session.elapsed)}
            </span>
          </div>

          {/* status */}
          <div className="absolute left-1/2 top-16 -translate-x-1/2">
            <span className="inline-flex h-8 items-center gap-2 rounded-full bg-black/45 px-3.5 text-caption font-medium text-white backdrop-blur" aria-live="polite">
              <span className={cn("size-2 rounded-full", status.dot, !session.paused && "animate-pulse")} />
              {session.paused ? "Paused" : status.label}
              {(saying || session.stage === "listening") && !session.paused && (
                <Waveform active tone={session.stage === "listening" ? "you" : "coach"} />
              )}
            </span>
          </div>

          {/* captions */}
          {captions && (
            <div className="absolute inset-x-4 bottom-4 grid gap-2 sm:inset-x-10">
              {session.stage === "feedback" ? (
                <p className="mx-auto max-w-2xl rounded-2xl border border-amber-300/30 bg-amber-950/60 px-4 py-3 text-center text-body text-amber-50 backdrop-blur-md">
                  <span className="mr-1.5" aria-hidden>
                    {langMeta.flag}
                  </span>
                  {session.caption}
                  <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-white/80" />
                </p>
              ) : session.stage === "coach" || session.stage === "your-turn" ? (
                <p className="mx-auto max-w-2xl rounded-2xl bg-black/60 px-4 py-3 text-center text-body text-white backdrop-blur-md">
                  {session.caption}
                  {session.stage === "coach" && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-white/80" />}
                </p>
              ) : session.stage === "listening" ? (
                <p className="mx-auto max-w-2xl rounded-2xl border border-sky-300/30 bg-sky-950/60 px-4 py-3 text-center text-body text-sky-50 backdrop-blur-md">
                  {session.liveTranscript || <span className="text-sky-200/70">Start speaking…</span>}
                </p>
              ) : (
                <p className="mx-auto flex items-center gap-2 rounded-2xl bg-black/60 px-4 py-2.5 text-body-sm text-white/80 backdrop-blur-md">
                  <Sparkles className="size-4 text-violet-300" aria-hidden />
                  Checking your grammar, vocabulary and fluency…
                </p>
              )}
            </div>
          )}
        </StageFrame>

        {/* control dock */}
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border bg-surface p-3">
          <DockButton
            label={captions ? "Hide captions" : "Show captions"}
            onClick={() => setCaptions((c) => !c)}
            icon={captions ? Captions : CaptionsOff}
          />
          <DockButton
            label={settings.voice ? "Mute coach" : "Unmute coach"}
            onClick={() => onSettings({ ...settings, voice: !settings.voice })}
            icon={settings.voice ? Volume2 : VolumeX}
          />
          <DockButton
            label={settings.view === "head" ? "Show upper body" : settings.view === "upper" ? "Show full body" : "Show face"}
            onClick={() =>
              onSettings({ ...settings, view: settings.view === "head" ? "upper" : settings.view === "upper" ? "full" : "head" })
            }
            icon={ScanFace}
          />
          <DockButton
            label="Give me an idea"
            onClick={() => setHintFor(hint ? null : session.index)}
            icon={Lightbulb}
            active={hint}
            disabled={session.stage === "thinking"}
          />

          <MicButton session={session} />

          <DockButton
            label={session.paused ? "Resume" : "Pause"}
            onClick={() => session.setPaused(!session.paused)}
            icon={session.paused ? Play : Pause}
          />
          <button
            type="button"
            onClick={session.end}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-error px-5 text-body-sm font-semibold text-error-foreground transition-colors hover:bg-error/90"
          >
            <PhoneOff className="size-4" aria-hidden />
            End
          </button>
        </div>

        {hint && session.turn && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-body-sm">
            <Lightbulb className="size-4 text-amber-500" aria-hidden />
            <span className="text-fg-secondary">Try weaving in:</span>
            {session.turn.suggestions.map((s) => (
              <span key={s} className="rounded-full border bg-surface px-2.5 py-0.5 text-caption font-medium">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <SidePanel session={session} coach={coach} lang={settings.lang} />
    </div>
  );
}

function DockButton({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-12 place-items-center rounded-full border bg-surface-elevated text-fg-secondary transition-colors duration-micro outline-none",
        "hover:bg-surface-hover hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-40",
        active && "border-amber-400/50 bg-amber-400/15 text-amber-600 dark:text-amber-300",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

function MicButton({ session }: { session: CoachSession }) {
  const listening = session.stage === "listening";
  const ready = session.stage === "your-turn";
  const disabled = session.paused || (!listening && !ready);

  return (
    <div className="relative mx-2 grid place-items-center">
      {(listening || ready) && !session.paused && (
        <>
          <span aria-hidden className={cn("coach-pulse absolute inset-0 rounded-full", listening ? "bg-sky-400/50" : "bg-primary/50")} />
          <span aria-hidden className={cn("coach-pulse coach-pulse-delay absolute inset-0 rounded-full", listening ? "bg-sky-400/40" : "bg-primary/40")} />
        </>
      )}
      <button
        type="button"
        onClick={listening ? session.finishAnswer : session.startAnswer}
        disabled={disabled}
        aria-label={listening ? "Done speaking" : "Start speaking"}
        className={cn(
          "relative grid size-16 place-items-center rounded-full text-white shadow-lg outline-none transition-all duration-normal",
          "focus-visible:ring-[4px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-surface-active disabled:text-fg-muted disabled:shadow-none",
          listening ? "bg-sky-500 hover:bg-sky-600" : "bg-primary hover:bg-primary-hover",
        )}
      >
        {listening ? <Square className="size-5 fill-current" aria-hidden /> : <Mic className="size-6" aria-hidden />}
      </button>
    </div>
  );
}

const PANEL_TEXT: Record<FeedbackLang, { good: string; fix: string }> = {
  en: { good: "Nice one", fix: "Say it better" },
  uz: { good: "Zo'r", fix: "To'g'rirog'i" },
};

function SidePanel({ session, coach, lang }: { session: CoachSession; coach: CoachPersona; lang: FeedbackLang }) {
  const [tab, setTab] = useState<"chat" | "feedback">("chat");
  const list = useRef<HTMLOListElement>(null);
  const corrections = session.messages.filter((m) => m.role === "you" && m.feedback);
  const wordsSaid = session.messages.filter((m) => m.role === "you").reduce((n, m) => n + m.text.split(" ").length, 0);
  const pace = session.elapsed > 0 ? Math.min(180, Math.round((wordsSaid / Math.max(session.elapsed, 1)) * 60 * 2.2)) : 0;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [session.messages.length, session.liveTranscript]);

  return (
    <aside className="flex h-[min(68vh,40rem)] min-h-[26rem] flex-col overflow-hidden rounded-2xl border bg-surface xl:h-[calc(min(68vh,40rem)+5.25rem)]">
      <div className="flex gap-1 border-b p-1.5">
        {(
          [
            { value: "chat", label: "Conversation" },
            { value: "feedback", label: `Feedback${corrections.length ? ` · ${corrections.length}` : ""}` },
          ] as const
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "h-8 flex-1 rounded-lg text-body-sm font-medium transition-colors duration-micro",
              tab === t.value ? "bg-surface-active text-foreground" : "text-fg-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <ol ref={list} className="grid flex-1 content-start gap-3 overflow-y-auto p-4">
          {session.messages.map((m) => (
            <li key={m.id} className={cn("flex gap-2", m.role === "you" && "flex-row-reverse")}>
              {m.role === "coach" && (
                <CoachBadge persona={coach} className="size-8 rounded-full text-caption" />
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-body-sm",
                  m.role === "you"
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : m.kind === "feedback"
                      ? "rounded-tl-sm border border-amber-400/30 bg-amber-400/10"
                      : "rounded-tl-sm bg-surface-active",
                )}
              >
                {m.text}
              </div>
            </li>
          ))}
          {session.stage === "listening" && session.liveTranscript && (
            <li className="flex flex-row-reverse">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-dashed border-primary/50 px-3.5 py-2.5 text-body-sm text-fg-secondary">
                {session.liveTranscript}…
              </div>
            </li>
          )}
        </ol>
      ) : (
        <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Pace" value={pace ? `${pace}` : "—"} unit="wpm" />
            <Metric label="Answers" value={`${corrections.length}`} />
            <Metric label="Fixes" value={`${corrections.filter((c) => c.feedback?.tone === "fix").length}`} />
          </div>
          {corrections.length === 0 ? (
            <p className="rounded-xl border border-dashed p-5 text-center text-body-sm text-fg-muted">
              Answer the first question — corrections appear here the moment you finish a sentence.
            </p>
          ) : (
            <ul className="grid gap-2.5">
              {[...corrections].reverse().map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "grid gap-1.5 rounded-xl border p-3 text-body-sm",
                    m.feedback?.tone === "good" ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-caption font-semibold">
                    {m.feedback?.tone === "good" ? (
                      <>
                        <Award className="size-3.5 text-success" aria-hidden /> {PANEL_TEXT[lang].good}
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3.5 text-warning-text" aria-hidden /> {PANEL_TEXT[lang].fix}
                      </>
                    )}
                  </span>
                  {m.feedback?.original && (
                    <span>
                      <span className="text-error line-through decoration-error/60">{m.feedback.original}</span>
                      <span className="mx-1.5 text-fg-muted">→</span>
                      <span className="font-medium text-success">{m.feedback.better}</span>
                    </span>
                  )}
                  <span className="text-caption text-fg-secondary">{m.feedback?.note[lang]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="grid gap-0.5 rounded-xl border bg-surface-elevated/60 p-2.5">
      <span className="text-caption text-fg-muted">{label}</span>
      <span className="text-h4 tabular-nums">
        {value}
        {unit && <span className="ml-1 text-caption font-normal text-fg-muted">{unit}</span>}
      </span>
    </div>
  );
}

// ---- Summary --------------------------------------------------------------------------------

function Summary({
  coach,
  topic,
  onAgain,
  onLobby,
}: {
  coach: CoachPersona;
  topic: CoachTopic | null;
  onAgain: () => void;
  onLobby: () => void;
}) {
  const overall = Math.round((PREVIEW_SCORES.reduce((n, s) => n + s.band, 0) / PREVIEW_SCORES.length) * 2) / 2;
  const ring = (overall / 9) * 100;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <section className="grid justify-items-center gap-4 overflow-hidden rounded-2xl border bg-surface p-6 text-center">
        <div className="relative grid size-44 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
            <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="7" className="text-surface-active" />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${(ring / 100) * 276.5} 276.5`}
              className="text-primary"
            />
          </svg>
          <div className="grid">
            <span className="text-caption text-fg-muted">Estimated band</span>
            <span className="text-display tabular-nums leading-none">{overall.toFixed(1)}</span>
          </div>
        </div>
        <div className="grid gap-1">
          <h2 className="text-h3">Great conversation!</h2>
          <p className="text-body-sm text-fg-secondary">
            {coach.name} · {topic?.title ?? "Free conversation"}
          </p>
          <Badge variant="warning" className="mx-auto mt-1">Preview scores</Badge>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onAgain}>
            <RotateCcw aria-hidden />
            Talk again
          </Button>
          <Button variant="outline" onClick={onLobby}>
            New topic
          </Button>
        </div>
      </section>

      <div className="grid gap-5">
        <section className="grid gap-4 rounded-2xl border bg-surface p-5">
          <h3 className="text-h4">Your breakdown</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {PREVIEW_SCORES.map((s) => (
              <div key={s.key} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-body-sm text-fg-secondary">{s.label}</span>
                  <span className="text-h4 tabular-nums">{s.band.toFixed(1)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-active">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary" style={{ width: `${(s.band / 9) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="grid content-start gap-3 rounded-2xl border bg-surface p-5">
            <h3 className="flex items-center gap-2 text-h4">
              <Award className="size-4 text-success" aria-hidden />
              What went well
            </h3>
            <ul className="grid gap-2 text-body-sm text-fg-secondary">
              <li>Clear stories with a time, place and feeling.</li>
              <li>Natural second conditional: “If I could change one thing, I would…”.</li>
              <li>Steady pace with few long pauses.</li>
            </ul>
          </section>
          <section className="grid content-start gap-3 rounded-2xl border bg-surface p-5">
            <h3 className="flex items-center gap-2 text-h4">
              <Sparkles className="size-4 text-warning-text" aria-hidden />
              Practise next
            </h3>
            <ul className="grid gap-2 text-body-sm">
              {[
                ["I was spending a lot of time", "I spent a lot of time"],
                ["more different", "quite differently"],
                ["different background", "a different background"],
              ].map(([from, to]) => (
                <li key={from}>
                  <span className="text-error line-through decoration-error/60">{from}</span>
                  <span className="mx-1.5 text-fg-muted">→</span>
                  <span className="font-medium text-success">{to}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
