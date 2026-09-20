"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useSession } from "@/features/auth/hooks";
import { queryKeys } from "@/lib/query/keys";

import { grammarApi, type GrammarLevelFilter } from "./api";

function useAuthed() {
  return useSession().status === "authenticated";
}

/** The library's folders change rarely; the learner's counts inside them do not. */
const LIBRARY_STALE_TIME = 5 * 60_000;

export function useGrammarCategories() {
  return useQuery({
    queryKey: queryKeys.grammar.categories,
    queryFn: grammarApi.categories,
    enabled: useAuthed(),
    staleTime: LIBRARY_STALE_TIME,
  });
}

/** Topics for one category, fetched when it is expanded rather than all at once. */
export function useGrammarTopics(category: string | null, level: GrammarLevelFilter) {
  return useQuery({
    queryKey: queryKeys.grammar.topics(category ?? "", level),
    queryFn: () => grammarApi.topics({ category: category ?? undefined, level }),
    enabled: useAuthed() && Boolean(category),
    staleTime: LIBRARY_STALE_TIME,
  });
}

/**
 * Debounced so typing does not fire a request per keystroke, and `keepPreviousData` so the
 * results do not flash empty between them.
 */
export function useGrammarSearch(query: string, level: GrammarLevelFilter, delayMs = 250) {
  const [debounced, setDebounced] = useState(query);
  const authed = useAuthed();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), delayMs);
    return () => clearTimeout(timer);
  }, [query, delayMs]);

  const term = debounced.trim();
  return {
    ...useQuery({
      queryKey: queryKeys.grammar.search(term, level),
      queryFn: ({ signal }) => grammarApi.search(term, level, signal),
      enabled: authed && term.length > 0,
      placeholderData: keepPreviousData,
      staleTime: 60_000,
    }),
    /** True while the user has typed something the debounce has not caught up with. */
    pending: query.trim() !== term,
  };
}

export function useGrammarTopic(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.grammar.topic(slug ?? ""),
    queryFn: () => grammarApi.topic(slug!),
    enabled: useAuthed() && Boolean(slug),
  });
}

export function useGrammarComparison(slug: string | undefined, other: string | undefined) {
  return useQuery({
    queryKey: queryKeys.grammar.comparison(slug ?? "", other ?? ""),
    queryFn: () => grammarApi.comparison(slug!, other!),
    enabled: useAuthed() && Boolean(slug) && Boolean(other),
  });
}

export function useGrammarMap() {
  return useQuery({
    queryKey: queryKeys.grammar.map,
    queryFn: grammarApi.map,
    enabled: useAuthed(),
    staleTime: LIBRARY_STALE_TIME,
  });
}

export function useGrammarOverview() {
  return useQuery({ queryKey: queryKeys.grammar.overview, queryFn: grammarApi.overview, enabled: useAuthed() });
}

export function useGrammarProgress() {
  return useQuery({ queryKey: queryKeys.grammar.progress, queryFn: grammarApi.progress, enabled: useAuthed() });
}

/**
 * The AI explanation loads with the topic rather than on a button press.
 *
 * It is cached on the server per topic, level and language, so only the first learner to
 * open a topic pays for a generation; everyone after them gets a database read. That is
 * what makes automatic loading affordable — and it has to be automatic, because for the
 * topics with no canonical text yet this IS the lesson.
 */
export function useGrammarExplanation(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.grammar.explanation(slug ?? ""),
    queryFn: () => grammarApi.explain(slug!),
    enabled: useAuthed() && Boolean(slug),
    staleTime: 60 * 60_000,
    // A provider outage is not worth three retries per topic view; the page works without it.
    retry: false,
  });
}

export function useGrammarTutor(slug: string) {
  return useMutation({
    mutationFn: (vars: { question: string; history: { role: "user" | "assistant"; content: string }[] }) =>
      grammarApi.ask(slug, vars.question, vars.history),
  });
}

export function useGrammarVisual(slug: string) {
  return useMutation({ mutationFn: (vars: { kind?: string; compare?: string } = {}) => grammarApi.visualize(slug, vars.kind, vars.compare) });
}

export function useStartPractice(slug: string) {
  return useMutation({
    mutationFn: (vars: { mode?: "learning" | "test"; limit?: number; rule?: string }) =>
      grammarApi.startPractice(slug, vars),
  });
}

export function useAnswerQuestion(attemptId: string | undefined) {
  return useMutation({
    mutationFn: (vars: Parameters<typeof grammarApi.answer>[1]) => grammarApi.answer(attemptId!, vars),
  });
}

/** Completing a run changes mastery, so everything that shows it is invalidated. */
export function useCompletePractice(attemptId: string | undefined, slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => grammarApi.complete(attemptId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.grammar.topic(slug) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grammar.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grammar.progress });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grammar.categories });
      void queryClient.invalidateQueries({ queryKey: queryKeys.progress.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mistakes.summary });
    },
  });
}
