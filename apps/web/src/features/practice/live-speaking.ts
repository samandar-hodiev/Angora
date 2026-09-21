"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { refreshSession, sessionStore } from "@/features/auth/session";
import { API_VERSION, env } from "@/lib/env";

/**
 * The live speaking coach's client side.
 *
 * Each turn is recorded in the browser, sent as one binary frame, and answered with a
 * transcript, feedback and the coach's next question — all inside one connection, so the
 * conversation has context and the whole exchange is saved as one practice session.
 *
 * Two details are worth knowing about.
 *
 *   - The access token travels in `Sec-WebSocket-Protocol`, as the second entry of
 *     ["bearer", token]. The browser's WebSocket API cannot set headers, and the usual
 *     workaround — the token in the query string — writes a credential into access logs,
 *     proxy logs and browser history. This way it stays a header.
 *   - The token is refreshed before connecting rather than after a failure. A socket
 *     rejected for an expired token gives the client no status code to react to, so the
 *     cheap thing to do is not to be expired.
 */

export interface LiveTurn {
  turn: number;
  transcript: string;
  words_per_minute: number;
  score: number;
  reply: string;
  feedback?: {
    fluency: number;
    grammar: number;
    vocabulary: number;
    relevance: number;
    cefr_estimate: string;
    confidence: number;
    mistakes: { category: string; original: string; correction: string; explanation: string; severity: string }[];
  };
}

export interface LiveSummary {
  session_id: string;
  turns: number;
  overall_score?: number;
  cefr_estimate?: string;
  duration_ms?: number;
}

export type LiveStatus = "idle" | "connecting" | "ready" | "thinking" | "finished" | "error";

interface ServerMessage {
  type: "ready" | "turn" | "summary" | "error";
  session_id?: string;
  prompt?: string;
  level?: string;
  max_turns?: number;
  turn?: LiveTurn;
  turns?: number;
  overall_score?: number;
  cefr_estimate?: string;
  duration_ms?: number;
  code?: string;
  message?: string;
}

export function useLiveSpeaking() {
  const socket = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [prompt, setPrompt] = useState("");
  const [level, setLevel] = useState("");
  const [maxTurns, setMaxTurns] = useState(0);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Closing on unmount matters more here than usual: an open socket holds a session row
  // that would otherwise sit unfinished until the server's idle timeout.
  useEffect(() => {
    return () => {
      socket.current?.close();
      socket.current = null;
    };
  }, []);

  const connect = useCallback(async (taskId?: string) => {
    setStatus("connecting");
    setError(null);
    setTurns([]);
    setSummary(null);

    const token = (await refreshSession()) ?? sessionStore.getState().accessToken;
    if (!token) {
      setStatus("error");
      setError("Your session has expired. Sign in again.");
      return;
    }

    const url = `${env.apiUrl.replace(/^http/, "ws")}/api/${API_VERSION}/speaking/live`;
    const ws = new WebSocket(url, ["bearer", token]);
    socket.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "start", task_id: taskId }));

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          setPrompt(msg.prompt ?? "");
          setLevel(msg.level ?? "");
          setMaxTurns(msg.max_turns ?? 0);
          setStatus("ready");
          break;
        case "turn":
          if (msg.turn) {
            setTurns((current) => [...current, msg.turn!]);
            setPrompt(msg.turn.reply);
          }
          setStatus("ready");
          break;
        case "summary":
          setSummary({
            session_id: msg.session_id ?? "",
            turns: msg.turns ?? 0,
            overall_score: msg.overall_score,
            cefr_estimate: msg.cefr_estimate,
            duration_ms: msg.duration_ms,
          });
          setStatus("finished");
          break;
        case "error":
          // A rejected turn is not a rejected session: the server keeps the conversation
          // open, so the learner is told what went wrong and can simply speak again.
          setError(msg.message ?? "Something went wrong");
          setStatus((current) => (current === "finished" ? current : "ready"));
          break;
      }
    };

    ws.onerror = () => {
      setError("The connection to your coach dropped.");
      setStatus("error");
    };

    ws.onclose = () => {
      socket.current = null;
      setStatus((current) => (current === "finished" ? current : current === "error" ? current : "finished"));
    };
  }, []);

  const sendTurn = useCallback(async (blob: Blob, mimeType: string, durationMs: number) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setStatus("thinking");
    setError(null);
    ws.send(await blob.arrayBuffer());
    ws.send(JSON.stringify({ type: "turn_end", duration_ms: durationMs, mime_type: mimeType }));
  }, []);

  const finish = useCallback(() => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus("finished");
      return;
    }
    ws.send(JSON.stringify({ type: "finish" }));
  }, []);

  return { status, prompt, level, maxTurns, turns, summary, error, connect, sendTurn, finish };
}
