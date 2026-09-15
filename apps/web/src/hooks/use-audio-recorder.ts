"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { pickMimeType, rmsLevel } from "@/lib/audio";

export type RecorderStatus = "idle" | "requesting" | "recording" | "paused" | "stopped" | "denied" | "unsupported" | "error";

interface Options {
  maxDurationMs: number;
  bars?: number;
}

/**
 * Microphone recording with live loudness levels for a waveform. The resulting Blob is
 * handed to the caller; uploading and analysis are handled by the speaking feature via the
 * API so the recording and its results are available on every device.
 */
export function useAudioRecorder({ maxDurationMs, bars = 40 }: Options) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0));
  const [recording, setRecording] = useState<{ blob: Blob; url: string; mimeType: string } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const accumulatedRef = useRef(0);
  const resumedAtRef = useRef<number | null>(null);

  const teardown = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  const currentElapsed = () =>
    accumulatedRef.current + (resumedAtRef.current !== null ? performance.now() - resumedAtRef.current : 0);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    accumulatedRef.current = currentElapsed();
    resumedAtRef.current = null;
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("unsupported");
      return;
    }
    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      setStatus(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "error");
      return;
    }

    streamRef.current = stream;
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];
    accumulatedRef.current = 0;
    resumedAtRef.current = performance.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      setRecording((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { blob, url: URL.createObjectURL(blob), mimeType: type };
      });
      setElapsedMs(accumulatedRef.current);
      setStatus("stopped");
      teardown();
    };

    const context = new AudioContext();
    audioContextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);
    let lastPush = 0;

    const tick = (now: number) => {
      const elapsed = currentElapsed();
      setElapsedMs(elapsed);
      if (elapsed >= maxDurationMs) {
        stop();
        return;
      }
      if (now - lastPush > 60) {
        lastPush = now;
        const paused = recorderRef.current?.state === "paused";
        analyser.getByteTimeDomainData(buffer);
        const level = paused ? 0 : rmsLevel(buffer);
        setLevels((prev) => [...prev.slice(1), level]);
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    recorder.start(250);
    setStatus("recording");
  }, [maxDurationMs, stop, teardown]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    recorder.pause();
    accumulatedRef.current = currentElapsed();
    resumedAtRef.current = null;
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "paused") return;
    recorder.resume();
    resumedAtRef.current = performance.now();
    setStatus("recording");
  }, []);

  const reset = useCallback(() => {
    stop();
    teardown();
    setRecording((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    setElapsedMs(0);
    setLevels(Array(bars).fill(0));
    setStatus("idle");
  }, [bars, stop, teardown]);

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      teardown();
    },
    [teardown],
  );

  return { status, elapsedMs, levels, recording, start, pause, resume, stop, reset };
}
