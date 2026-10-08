"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { FeedbackLang, ScriptTurn } from "./coach-config";

/**
 * The coach's conversation loop, played from a script.
 *
 * The realtime backend will replace the timers here with socket events, so the states are the
 * ones that conversation really has: the coach asking, waiting for you, listening while you
 * talk, thinking about what you said, then telling you what to fix — in the feedback language
 * the learner chose — before the next question. The screen only reads `stage`, so swapping
 * the source leaves the UI alone.
 */

export type CoachStage = "coach" | "your-turn" | "listening" | "thinking" | "feedback";

export interface CoachMessage {
  id: string;
  role: "coach" | "you";
  text: string;
  feedback?: ScriptTurn["feedback"];
  /** The coach's spoken correction, as opposed to a question. */
  kind?: "feedback";
}

/** Speaking pace: the captions type at it and the 3D coach times its lips to it. */
export const CHAR_MS = 62;
const WORD_MS = 240;
const THINK_MS = 1500;

export function useCoachPreview(script: ScriptTurn[], lang: FeedbackLang) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<CoachStage>("coach");
  const [chars, setChars] = useState(0);
  const [words, setWords] = useState(0);
  const [answers, setAnswers] = useState<CoachMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  const turn = script[index];
  const question = turn?.question ?? "";
  const spokenFeedback = turn?.feedback.spoken[lang] ?? "";
  /** What the coach is saying right now: the question, or the correction after your answer. */
  const line = stage === "feedback" ? spokenFeedback : question;
  const answerWords = useMemo(() => (turn?.sampleAnswer ?? "").split(" "), [turn]);

  const advance = useCallback(() => {
    const next = index + 1;
    if (next >= script.length) {
      setFinished(true);
      return;
    }
    setIndex(next);
    setChars(0);
    setStage("coach");
  }, [index, script.length]);

  // The coach says the line: typed out at speaking pace, then on to what comes next.
  useEffect(() => {
    if ((stage !== "coach" && stage !== "feedback") || paused || finished) return;
    if (chars >= line.length) {
      const handle = window.setTimeout(() => (stage === "coach" ? setStage("your-turn") : advance()), 650);
      return () => window.clearTimeout(handle);
    }
    const handle = window.setTimeout(() => setChars((c) => c + 1), CHAR_MS);
    return () => window.clearTimeout(handle);
  }, [stage, chars, line, paused, finished, advance]);

  // While you talk, the transcript fills in word by word.
  useEffect(() => {
    if (stage !== "listening" || paused || words >= answerWords.length) return;
    const handle = window.setTimeout(() => setWords((w) => w + 1), WORD_MS);
    return () => window.clearTimeout(handle);
  }, [stage, words, answerWords, paused]);

  const startAnswer = useCallback(() => {
    if (stage !== "your-turn") return;
    setWords(0);
    setStage("listening");
  }, [stage]);

  const finishAnswer = useCallback(() => {
    if (stage !== "listening" || !turn) return;
    const said = answerWords.slice(0, Math.max(words, 6)).join(" ");
    setAnswers((m) => [...m, { id: `you-${index}`, role: "you", text: said, feedback: turn.feedback }]);
    setStage("thinking");
  }, [stage, turn, answerWords, words, index]);

  useEffect(() => {
    if (stage !== "thinking" || paused) return;
    const handle = window.setTimeout(() => {
      setChars(0);
      setStage("feedback");
    }, THINK_MS);
    return () => window.clearTimeout(handle);
  }, [stage, paused]);

  useEffect(() => {
    if (paused || finished) return;
    const handle = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(handle);
  }, [paused, finished]);

  // Each line joins the transcript the moment the coach starts saying it.
  const messages = useMemo(() => {
    const list: CoachMessage[] = [];
    script.slice(0, index + 1).forEach((t, i) => {
      list.push({ id: `coach-${i}`, role: "coach", text: t.question });
      const answer = answers.find((x) => x.id === `you-${i}`);
      if (!answer) return;
      list.push(answer);
      if (i < index || stage === "feedback") {
        list.push({ id: `feedback-${i}`, role: "coach", kind: "feedback", text: t.feedback.spoken[lang] });
      }
    });
    return list;
  }, [script, index, answers, stage, lang]);

  const end = useCallback(() => setFinished(true), []);

  return {
    turn,
    index,
    total: script.length,
    stage,
    /** The line being said, for the speech engine. */
    line,
    caption: line.slice(0, chars),
    liveTranscript: answerWords.slice(0, words).join(" "),
    messages,
    paused,
    setPaused,
    elapsed,
    finished,
    startAnswer,
    finishAnswer,
    end,
  };
}

export type CoachSession = ReturnType<typeof useCoachPreview>;
