"use client";

import { MessageCircle, Send } from "lucide-react";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { AIInsight, RecommendationCard } from "@/components/learning/cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { contentHref, skillHref } from "@/config/navigation";
import { EntitlementGate } from "@/features/subscription/components/subscription-views";
import { useFeature } from "@/features/subscription/hooks";
import { formatCategory } from "@/lib/learning-format";

import { useMistakeSummary, useProgress, useRecommendations } from "../hooks";

/** Coaching first, chat second: the coach reasons about the learner's own data. */
export function AICoachView() {
  const summary = useMistakeSummary();
  const recommendations = useRecommendations();
  const progress = useProgress();
  const chat = useFeature("ai_coach.chat");

  const focus = summary.data?.weaknesses.slice(0, 3) ?? [];
  const today = recommendations.data?.[0];
  const leastPractised = [...(progress.data?.skills ?? [])].sort((a, b) => a.sessions - b.sessions)[0];

  return (
    <>
      <PageHeader
        title="AI Coach"
        description="Personal guidance based on your mistakes, goals and progress."
        actions={!chat.isPending && <Badge variant={chat.allowed ? "success" : "secondary"}>{chat.allowed ? "Chat included in your plan" : "Chat available on Pro"}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <AIInsight title="Based on your recent activity">
          {summary.isPending ? (
            <Skeleton className="h-24" />
          ) : focus.length > 0 ? (
            <>
              <p className="text-h4">You should focus on:</p>
              <ol className="grid gap-2">
                {focus.map((w, i) => (
                  <li key={w.category} className="flex items-center gap-3">
                    <span className="grid size-6 place-items-center rounded-full bg-primary text-caption text-primary-foreground tabular-nums">{i + 1}</span>
                    <span>{formatCategory(w.category)}</span>
                    <span className="ml-auto text-caption text-fg-muted">{w.evidence_count} occurrences</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-fg-secondary">Complete a few speaking or writing sessions and your coach will spot the patterns worth fixing first.</p>
          )}
        </AIInsight>

        <section aria-labelledby="today-title">
          <SectionTitle id="today-title" title="Today's recommendation" />
          {recommendations.isPending ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : today?.content ? (
            <RecommendationCard title={today.content.title} skill={today.content.skill} reason={today.reason} href={contentHref(today.content.skill, today.content.id)} />
          ) : leastPractised ? (
            <RecommendationCard title={`Practise ${leastPractised.name.toLowerCase()}`} skill={leastPractised.code} reason="Your least practised skill." href={skillHref(leastPractised.code)} />
          ) : (
            <EmptyState title="Nothing scheduled yet" className="py-8" />
          )}
        </section>
      </div>

      <section aria-labelledby="chat-title" className="mt-10">
        <SectionTitle id="chat-title" title="Ask your coach" />
        <EntitlementGate feature="ai_coach.chat">
          <div className="grid gap-4 rounded-xl border bg-surface p-5">
            <div className="grid min-h-40 place-items-center rounded-lg bg-surface-hover p-6 text-center">
              <div className="grid justify-items-center gap-2">
                <MessageCircle className="size-5 text-fg-muted" aria-hidden />
                <p className="text-body-sm text-fg-secondary">Conversations with your coach arrive in a later release.</p>
              </div>
            </div>
            <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
              <Input disabled placeholder="Ask about grammar, vocabulary or your plan…" aria-label="Message your coach" />
              <Button disabled type="submit">
                <Send aria-hidden /> Send
              </Button>
            </form>
          </div>
        </EntitlementGate>
      </section>
    </>
  );
}
