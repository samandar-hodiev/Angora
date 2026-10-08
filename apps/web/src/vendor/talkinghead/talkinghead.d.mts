// Types for the parts of TalkingHead the speaking coach uses.

export type TalkingHeadView = "full" | "mid" | "upper" | "head";

export class TalkingHead {
  constructor(node: HTMLElement, options?: Record<string, unknown>);
  audioCtx: AudioContext;
  renderer: import("three").WebGLRenderer;
  scene: import("three").Scene;
  lipsync: Record<string, unknown>;
  showAvatar(
    avatar: { url: string; body: "F" | "M"; avatarMood?: string; lipsyncLang?: string; ttsLang?: string },
    onprogress?: (event: ProgressEvent) => void,
  ): Promise<void>;
  speakAudio(input: { audio?: AudioBuffer; words?: string[]; wtimes?: number[]; wdurations?: number[] }): void;
  stopSpeaking(): void;
  setView(view: TalkingHeadView, options?: Record<string, unknown>): void;
  setMood(mood: string): void;
  playGesture(name: string, duration?: number, mirror?: boolean, ms?: number): void;
  lookAtCamera(ms: number): void;
  makeEyeContact(ms: number): void;
  start(): void;
  stop(): void;
  dispose?(): void;
}
