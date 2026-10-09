"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { refreshSession, sessionStore } from "@/features/auth/session";
import { apiClient, isApiError } from "@/lib/api";
import { pickMimeType } from "@/lib/audio";
import { API_VERSION, env } from "@/lib/env";

import type { CoachMode, FeedbackLang } from "./coach-config";

/**
 * The live coach conversation, against the real backend (`/speaking/live`).
 *
 * The screen reads one shape — stage, the line being said, the transcript of messages — and
 * this hook fills it from the socket:
 *
 *   ready  → the coach asks its opening question                    (stage "coach")
 *            the learner taps the mic and speaks                     ("your-turn" → "listening")
 *            the recording goes up as one binary frame               ("thinking")
 *   turn   → the coach says its correction, in the feedback language ("feedback")
 *            then asks the next question, in English                 ("coach")
 *   summary→ the conversation is saved                               (finished)
 *
 * A line "is said" for as long as its captions take to type at CHAR_MS a character; the 3D
 * coach times its lips and voice to the same clock. Before connecting, the hook asks the API
 * whether a conversation can start at all — a refused WebSocket tells the browser nothing,
 * a JSON answer can say "your plan does not include this" or "it is open in another tab".
 */

export type CoachStage = "coach" | "your-turn" | "listening" | "thinking" | "feedback";

export interface CoachFeedback {
  tone: "good" | "fix";
  original?: string;
  better?: string;
  note?: string;
}

export interface CoachMessage {
  id: string;
  role: "coach" | "you";
  text: string;
  feedback?: CoachFeedback;
  /** The coach's spoken correction, as opposed to a question. */
  kind?: "feedback";
}

export interface CoachTurnResult {
  turn: number;
  transcript: string;
  score: number;
  wordsPerMinute: number;
  criteria?: { fluency: number; grammar: number; vocabulary: number; relevance: number };
  cefr?: string;
  mistakes: { original: string; correction: string; explanation: string }[];
}

export interface CoachSummary {
  turns: number;
  overallScore?: number;
  cefr?: string;
  durationMs?: number;
  results: CoachTurnResult[];
}

export type CoachConnection = "checking" | "connecting" | "live" | "ending" | "finished" | "error";

/** Speaking pace: the captions type at it and the 3D coach times its lips to it. */
export const CHAR_MS = 62;
/** One answer at most; the server rejects longer turns anyway. */
const MAX_ANSWER_MS = 90_000;
/** Shorter than this the server cannot judge it; better to say so before sending. */
const MIN_ANSWER_MS = 3_000;

interface ServerTurn {
  turn: number;
  transcript: string;
  words_per_minute: number;
  score: number;
  say?: string;
  reply: string;
  feedback?: {
    fluency: number;
    grammar: number;
    vocabulary: number;
    relevance: number;
    cefr_estimate: string;
    mistakes: { original: string; correction: string; explanation: string }[];
  };
}

interface ServerMessage {
  type: "ready" | "turn" | "summary" | "error" | "reconnect";
  prompt?: string;
  max_turns?: number;
  turn?: ServerTurn;
  turns?: number;
  overall_score?: number;
  cefr_estimate?: string;
  duration_ms?: number;
  code?: string;
  message?: string;
}

export function useCoachLive(options: { taskId?: string; topic?: string; mode: CoachMode; lang: FeedbackLang }) {
  const [connection, setConnection] = useState<CoachConnection>("checking");
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  /** A problem with one turn — the conversation goes on. */
  const [notice, setNotice] = useState<string | null>(null);

  const [stage, setStage] = useState<CoachStage>("coach");
  const [line, setLine] = useState("");
  const [chars, setChars] = useState(0);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(8);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordingMs, setRecordingMs] = useState(0);
  const [lastTone, setLastTone] = useState<"good" | "fix" | null>(null);
  const [summary, setSummary] = useState<CoachSummary | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordStart = useRef(0);
  /** The question to ask once the spoken feedback is done. */
  const nextQuestion = useRef<string | null>(null);
  const results = useRef<CoachTurnResult[]>([]);
  const pendingSummary = useRef<CoachSummary | null>(null);
  const opts = useRef(options);
  // Mirrors for the socket handlers, which outlive the render they were created in.
  const stageRef = useRef(stage);
  const connectionRef = useRef(connection);
  useEffect(() => {
    stageRef.current = stage;
    connectionRef.current = connection;
  }, [stage, connection]);

  const finish = useCallback((result: CoachSummary) => {
    setSummary(result);
    setConnection("finished");
    connectionRef.current = "finished";
    socket.current?.close();
  }, []);

  const askNext = useCallback(() => {
    const question = nextQuestion.current;
    nextQuestion.current = null;
    if (pendingSummary.current) {
      finish(pendingSummary.current);
      return;
    }
    if (!question) {
      setStage("your-turn");
      return;
    }
    setMessages((m) => [...m, { id: `coach-q-${Date.now()}`, role: "coach", text: question }]);
    setLine(question);
    setChars(0);
    setStage("coach");
  }, [finish]);

  // ---- connecting ------------------------------------------------------------------------------

  const connect = useCallback(async () => {
    setError(null);
    setNotice(null);
    setConnection("checking");

    // Can a conversation start at all? Plan, capacity, another tab — answered as JSON.
    try {
      await apiClient.get("/speaking/live/status");
    } catch (e) {
      setConnection("error");
      setError(isApiError(e) ? { code: e.code, message: e.message } : { message: "The coach is unavailable right now." });
      return;
    }

    // The microphone before the socket: a learner who says no should hear why at once, not
    // after the coach has already asked a question they cannot answer.
    if (!stream.current) {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        setConnection("error");
        setError({
          code: "MIC_DENIED",
          message: "Allow microphone access in your browser to talk to the coach, then try again.",
        });
        return;
      }
    }

    setConnection("connecting");
    const token = (await refreshSession()) ?? sessionStore.getState().accessToken;
    if (!token) {
      setConnection("error");
      setError({ code: "UNAUTHORIZED", message: "Your session has expired. Sign in again." });
      return;
    }

    const ws = new WebSocket(`${env.apiUrl.replace(/^http/, "ws")}/api/${API_VERSION}/speaking/live`, ["bearer", token]);
    socket.current = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      const { taskId, topic, mode, lang } = opts.current;
      ws.send(JSON.stringify({ type: "start", task_id: taskId, topic, mode, feedback_lang: lang }));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready": {
          const prompt = msg.prompt ?? "";
          setTotal(msg.max_turns ?? 8);
          setIndex(0);
          setMessages([{ id: "coach-0", role: "coach", text: prompt }]);
          setLine(prompt);
          setChars(0);
          setStage("coach");
          setConnection("live");
          break;
        }
        case "turn": {
          const t = msg.turn;
          if (!t) break;
          const mistakes = t.feedback?.mistakes ?? [];
          const first = mistakes[0];
          const feedback: CoachFeedback = first
            ? { tone: "fix", original: first.original, better: first.correction, note: first.explanation }
            : { tone: "good", note: t.say };
          results.current.push({
            turn: t.turn,
            transcript: t.transcript,
            score: t.score,
            wordsPerMinute: t.words_per_minute,
            criteria: t.feedback && {
              fluency: t.feedback.fluency,
              grammar: t.feedback.grammar,
              vocabulary: t.feedback.vocabulary,
              relevance: t.feedback.relevance,
            },
            cefr: t.feedback?.cefr_estimate,
            mistakes,
          });
          setLastTone(feedback.tone);
          setIndex(t.turn);
          nextQuestion.current = t.reply;
          setMessages((m) => [
            ...m,
            { id: `you-${t.turn}`, role: "you", text: t.transcript, feedback },
            ...(t.say ? [{ id: `feedback-${t.turn}`, role: "coach" as const, kind: "feedback" as const, text: t.say }] : []),
          ]);
          if (t.say) {
            setLine(t.say);
            setChars(0);
            setStage("feedback");
          } else {
            askNext();
          }
          break;
        }
        case "summary": {
          const result: CoachSummary = {
            turns: msg.turns ?? 0,
            overallScore: msg.overall_score,
            cefr: msg.cefr_estimate,
            durationMs: msg.duration_ms,
            results: results.current,
          };
          // The last turn's feedback is still being said; let the coach finish the sentence.
          pendingSummary.current = result;
          if (stageRef.current !== "feedback") finish(result);
          break;
        }
        case "error":
          // A rejected turn is not a rejected conversation: the learner can just speak again.
          setNotice(msg.message ?? "That turn did not go through. Try again.");
          setStage((current) => (current === "thinking" ? "your-turn" : current));
          break;
        case "reconnect":
          setConnection("error");
          setError({ code: "RECONNECT", message: "The coach was restarted. Your answers so far are saved — start again to continue." });
          break;
      }
    };

    ws.onclose = () => {
      socket.current = null;
      const current = connectionRef.current;
      // A summary on its way out (the coach finishing its last sentence) is not a drop.
      if (current === "finished" || current === "error" || pendingSummary.current) return;
      setError({
        code: opened ? "CONNECTION_LOST" : "UNAVAILABLE",
        message: opened
          ? "The connection to your coach dropped. Your answers so far are saved."
          : "Could not reach the coach. Check your connection and try again.",
      });
      setConnection("error");
    };
  }, [askNext, finish]);

  // ---- the conversation ------------------------------------------------------------------------


  // The coach "says" the line: captions typed at speaking pace, then on to what comes next.
  useEffect(() => {
    if ((stage !== "coach" && stage !== "feedback") || paused || connection !== "live") return;
    if (chars >= line.length) {
      const handle = window.setTimeout(() => (stage === "coach" ? setStage("your-turn") : askNext()), 650);
      return () => window.clearTimeout(handle);
    }
    const handle = window.setTimeout(() => setChars((c) => c + 1), CHAR_MS);
    return () => window.clearTimeout(handle);
  }, [stage, chars, line, paused, connection, askNext]);

  useEffect(() => {
    if (connection !== "live" || paused) return;
    const handle = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(handle);
  }, [connection, paused]);

  // ---- recording -------------------------------------------------------------------------------

  const sendRecording = useCallback((blob: Blob, mimeType: string, durationMs: number) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    void blob.arrayBuffer().then((buffer) => {
      ws.send(buffer);
      ws.send(JSON.stringify({ type: "turn_end", duration_ms: durationMs, mime_type: mimeType.split(";")[0] }));
    });
  }, []);

  const finishAnswer = useCallback(() => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
  }, []);

  const startAnswer = useCallback(() => {
    if (stage !== "your-turn" || !stream.current) return;
    setNotice(null);
    const mimeType = pickMimeType((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      recorder.current = null;
      const durationMs = Date.now() - recordStart.current;
      if (durationMs < MIN_ANSWER_MS) {
        setNotice("That was a bit short — say a full sentence or two.");
        setStage("your-turn");
        return;
      }
      const type = rec.mimeType || mimeType || "audio/webm";
      setStage("thinking");
      sendRecording(new Blob(chunks, { type }), type, durationMs);
    };
    recorder.current = rec;
    recordStart.current = Date.now();
    setRecordingMs(0);
    rec.start(250);
    setStage("listening");
  }, [stage, sendRecording]);

  // The recording timer, and the hard stop at the longest answer the server accepts.
  useEffect(() => {
    if (stage !== "listening") return;
    const handle = window.setInterval(() => {
      const ms = Date.now() - recordStart.current;
      setRecordingMs(ms);
      if (ms >= MAX_ANSWER_MS) finishAnswer();
    }, 200);
    return () => window.clearInterval(handle);
  }, [stage, finishAnswer]);

  const end = useCallback(() => {
    recorder.current?.stop();
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      finish({ turns: results.current.length, results: results.current });
      return;
    }
    setConnection("ending");
    connectionRef.current = "ending";
    ws.send(JSON.stringify({ type: "finish" }));
  }, [finish]);

  // ---- lifecycle -------------------------------------------------------------------------------

  useEffect(() => {
    // Deferred so the first render commits before the connection starts setting state.
    const handle = window.setTimeout(() => void connect(), 0);
    return () => {
      window.clearTimeout(handle);
      // An open socket holds a session row on the server; close it with the page.
      socket.current?.close();
      socket.current = null;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [connect]);

  const retry = useCallback(() => {
    results.current = [];
    pendingSummary.current = null;
    nextQuestion.current = null;
    setMessages([]);
    setElapsed(0);
    setSummary(null);
    void connect();
  }, [connect]);

  const caption = useMemo(() => line.slice(0, chars), [line, chars]);

  return {
    connection,
    error,
    notice,
    stage,
    index,
    total,
    line,
    caption,
    messages,
    paused,
    setPaused,
    elapsed,
    recordingMs,
    lastTone,
    summary,
    finished: connection === "finished",
    startAnswer,
    finishAnswer,
    end,
    retry,
  };
}

export type CoachSession = ReturnType<typeof useCoachLive>;
