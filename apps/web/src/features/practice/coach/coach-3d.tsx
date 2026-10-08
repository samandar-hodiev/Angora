"use client";

import type { TalkingHead, TalkingHeadView } from "@/vendor/talkinghead/talkinghead.mjs";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// Voice names that match the coach's body, across macOS, Windows and Chrome's voices.
const FEMALE_VOICE = /female|samantha|serena|kate|karen|moira|tessa|zira|susan|catherine|libby|sonia|natasha/i;
const MALE_VOICE = /\bmale|daniel|alex|fred|aaron|arthur|oliver|david|mark|george|ryan|lee|gordon|liam/i;

/*
 * A portrait studio: a soft warm key from the front-left, low ambient so faces keep their
 * shape, and a cool white rim from behind to separate hair and shoulders from the dark stage.
 * No coloured light touches the model — a tinted light was what made the colours bleed.
 */
const STUDIO_LIGHTS = {
  lightAmbientColor: 0xffffff,
  lightAmbientIntensity: 0.9,
  lightDirectColor: 0xfff3e6,
  lightDirectIntensity: 4.6,
  lightDirectPhi: 1.15,
  lightDirectTheta: 0.25,
  lightSpotColor: 0xe6eeff,
  lightSpotIntensity: 14,
  lightSpotPhi: 0.6,
  lightSpotTheta: 3.6,
  lightSpotDispersion: 0.8,
};
const STUDIO_EXPOSURE = 1.12;

/** Pixels the coach may render, at most — about two 4K frames' worth of a large stage. */
const MAX_RENDER_PIXELS = 9_000_000;

/**
 * How much denser than the screen to render (the library multiplies by devicePixelRatio).
 * 2× supersampling is what makes lashes, irises and hair edges read as sharp; the area cap
 * keeps a big stage on a weak GPU from rendering more than it can draw at 30 fps.
 */
function supersampling(container: HTMLElement) {
  const dpr = window.devicePixelRatio || 1;
  const area = Math.max(1, container.clientWidth * container.clientHeight);
  const total = Math.max(dpr, Math.min(dpr * 2, 4, Math.sqrt(MAX_RENDER_PIXELS / area)));
  return total / dpr;
}

/** Normal maps a little stronger than authored: pores, folds and hair strands catch the light. */
const NORMAL_BOOST = 1.35;

/**
 * Crisper materials: full anisotropic filtering, so fabric and hair stay sharp instead of
 * smearing at an angle, and a stronger normal map for surface detail.
 */
function sharpenTextures(head: TalkingHead) {
  const max = head.renderer.capabilities.getMaxAnisotropy();
  head.scene.traverse((object) => {
    const mesh = object as { material?: Record<string, unknown> | Record<string, unknown>[] };
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap"]) {
        const texture = material[key] as { anisotropy: number; needsUpdate: boolean } | null | undefined;
        if (texture) {
          texture.anisotropy = max;
          texture.needsUpdate = true;
        }
      }
      const normalScale = material.normalScale as { multiplyScalar(n: number): void } | undefined;
      if (material.normalMap && normalScale) normalScale.multiplyScalar(NORMAL_BOOST);
    }
  });
}

export type CoachState = "idle" | "speaking" | "listening" | "thinking";
export type CoachView = Extract<TalkingHeadView, "full" | "upper" | "head">;

/** One line for the coach to say. A new `id` starts a new line; the same id is never replayed. */
export interface CoachSpeech {
  id: string;
  text: string;
  /** How long each character takes — shared with the captions so lips and text stay together. */
  msPerChar: number;
  /** BCP-47 tag when the line is not in the coach's own accent — e.g. "uz-UZ" for feedback. */
  lang?: string;
}

/**
 * The coach as a 3D person: a rigged, full-body model (TalkingHead on three.js) that breathes,
 * shifts their weight, blinks, moves their brows, keeps eye contact and moves their lips to the
 * visemes of what they say.
 *
 * Until the realtime backend sends audio with word timings, the words are timed from the
 * caption speed, the mouth runs on a silent buffer of the same length, and the voice — if on —
 * is the browser's own speech synthesis. The backend replaces both with real TTS audio and its
 * timings; nothing above this component needs to change. A photoreal video avatar (HeyGen,
 * Simli, Tavus…) can later take this component's place behind the same props.
 */
export function Coach3D({
  model,
  body,
  view,
  state,
  mood = "neutral",
  speech,
  voice,
  voiceLang = "en-GB",
  gesture,
  className,
}: {
  model: string;
  body: "F" | "M";
  view: CoachView;
  state: CoachState;
  mood?: "neutral" | "happy";
  speech: CoachSpeech | null;
  voice: boolean;
  voiceLang?: string;
  /** A one-off gesture such as "thumbup"; a new id plays it again. */
  gesture?: { id: string; name: string } | null;
  className?: string;
}) {
  const node = useRef<HTMLDivElement>(null);
  const head = useRef<TalkingHead | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState(0);
  const initial = useRef({ view, mood });

  useEffect(() => {
    const container = node.current;
    if (!container) return;
    let cancelled = false;
    let instance: TalkingHead | null = null;

    (async () => {
      // Loaded on demand: three.js and the lip-sync rules are only needed on this screen.
      const [{ TalkingHead }, { LipsyncEn }, THREE] = await Promise.all([
        import("@/vendor/talkinghead/talkinghead.mjs"),
        import("@/vendor/talkinghead/lipsync-en.mjs"),
        import("three"),
      ]);
      if (cancelled) return;
      instance = new TalkingHead(container, {
        // The library imports lip-sync modules by relative path, which a bundler cannot follow;
        // the English rules are handed over below instead.
        lipsyncModules: [],
        lipsyncLang: "en",
        cameraView: initial.current.view,
        cameraRotateEnable: false,
        modelPixelRatio: supersampling(container),
        modelFPS: 30,
        avatarMood: initial.current.mood,
        // More eye contact and a little more head movement: a person who is listening to you,
        // not a mannequin waiting for a cue.
        avatarIdleEyeContact: 0.7,
        avatarIdleHeadMove: 0.7,
        avatarSpeakingEyeContact: 0.85,
        avatarSpeakingHeadMove: 0.7,
        ...STUDIO_LIGHTS,
      });
      // Neutral tone mapping keeps skin and clothes their own colour; the default (ACES) shifts
      // hues and flattens contrast, which is what made the models look washed out.
      instance.renderer.toneMapping = THREE.NeutralToneMapping;
      instance.renderer.toneMappingExposure = STUDIO_EXPOSURE;
      instance.lipsync.en = new LipsyncEn();
      await instance.showAvatar({ url: model, body, avatarMood: initial.current.mood, lipsyncLang: "en" }, (event) => {
        if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
      });
      if (cancelled) {
        try {
          instance.stop();
          instance.dispose?.();
        } catch {
          // See the cleanup below.
        }
        return;
      }
      sharpenTextures(instance);
      head.current = instance;
      setStatus("ready");
    })().catch(() => {
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      head.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      if (instance) {
        // The library's dispose assumes a fully loaded model; leaving mid-load must not crash.
        try {
          instance.stop();
          instance.dispose?.();
        } catch {
          // Nothing left to clean up that the container reset below does not cover.
        }
      }
      container.replaceChildren();
    };
  }, [model, body]);

  useEffect(() => {
    if (status === "ready") head.current?.setView(view);
  }, [view, status]);

  useEffect(() => {
    if (status === "ready") head.current?.setMood(mood);
  }, [mood, status]);

  // Saying a line: visemes timed to the captions over a silent buffer, plus the voice.
  useEffect(() => {
    const h = head.current;
    if (status !== "ready" || !h || !speech) return;

    const words: string[] = [];
    const wtimes: number[] = [];
    const wdurations: number[] = [];
    let offset = 0;
    for (const part of speech.text.split(/(\s+)/)) {
      if (part.trim()) {
        words.push(part);
        wtimes.push(offset * speech.msPerChar);
        wdurations.push(part.length * speech.msPerChar);
      }
      offset += part.length;
    }
    const totalMs = speech.text.length * speech.msPerChar + 200;
    const ctx = h.audioCtx;
    void ctx.resume?.();
    const silence = ctx.createBuffer(1, Math.ceil((ctx.sampleRate * totalMs) / 1000), ctx.sampleRate);
    h.speakAudio({ audio: silence, words, wtimes, wdurations });

    if (voice && "speechSynthesis" in window) {
      const lang = speech.lang ?? voiceLang;
      const family = lang.split("-")[0]!;
      const utterance = new SpeechSynthesisUtterance(speech.text);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang === lang && (body === "M" ? MALE_VOICE : FEMALE_VOICE).test(v.name)) ??
        voices.find((v) => v.lang === lang) ??
        voices.find((v) => v.lang.split("-")[0] === family);
      // An English voice reading Uzbek is worse than silence: without a voice for the
      // language the coach still mouths the words and the captions carry them.
      if (!preferred && family !== "en") return () => h.stopSpeaking();
      if (preferred) utterance.voice = preferred;
      utterance.lang = preferred?.lang ?? lang;
      // Matched to msPerChar so the voice ends about when the lips do.
      utterance.rate = Math.min(1.4, Math.max(0.7, 68 / speech.msPerChar));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }

    return () => {
      h.stopSpeaking();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [speech, status, voice, voiceLang, body]);

  // Listening is eye contact; thinking glances away for a moment, the way people do.
  useEffect(() => {
    const h = head.current;
    if (status !== "ready" || !h) return;
    if (state === "listening") h.makeEyeContact(60_000);
    if (state === "thinking") h.makeEyeContact(0);
  }, [state, status]);

  useEffect(() => {
    if (status === "ready" && gesture) head.current?.playGesture(gesture.name, 2.4);
  }, [gesture, status]);

  return (
    <div className={cn("relative", className)}>
      {/* A touch of contrast and colour on top of the neutral tone mapping, which is accurate
          but reads slightly flat on a dark stage. */}
      <div ref={node} className="absolute inset-0 [filter:contrast(1.06)_saturate(1.08)]" />
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid justify-items-center gap-3 text-white/80">
            <Loader2 className="size-6 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="text-caption">Your coach is getting ready… {progress > 0 ? `${progress}%` : ""}</span>
            <span className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: `${progress}%` }} />
            </span>
          </div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-body-sm text-white/70">
          The 3D coach could not load on this device. The conversation still works — follow the captions.
        </div>
      )}
    </div>
  );
}
