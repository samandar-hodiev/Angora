"use client";

import { ArrowRight, FileStack, PencilRuler, Send, SpellCheck } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { LiveDataState } from "../components/live-state";
import { OwnerPageHeader, SectionCard } from "../components/primitives";
import { useAnalyticsOverview, useGrammarAdminTopics, useLiveContent, useQuestionStats } from "../hooks";
import { formatDate, formatNumber } from "../lib/format";
import { isContentType } from "../components/nav";

/**
 * Content CMS, the front door.
 *
 * It answers the two questions an editor actually opens the CMS with: what is waiting for
 * me, and what did learners get recently. Everything is counted from the same tables the
 * learner app reads, so "published" here means published there.
 */

const lifecycle = [
  { status: "draft", label: "Draft", hint: "Being written. Learners cannot see it." },
  { status: "review", label: "In review", hint: "Written, waiting to be checked." },
  { status: "published", label: "Published", hint: "Live in the Learner App right now." },
  { status: "archived", label: "Archived", hint: "Taken down. History is kept." },
] as const;

export function ContentOverview() {
  const analytics = useAnalyticsOverview(30);
  const questions = useQuestionStats();
  const drafts = useLiveContent({ status: "draft", page: 1 });
  const review = useLiveContent({ status: "review", page: 1 });
  const grammar = useGrammarAdminTopics({ page: 1 });

  const byType = analytics.data?.content ?? [];
  const totals = byType.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      published: sum.published + row.published,
      review: sum.review + row.review,
      draft: sum.draft + row.draft,
    }),
    { total: 0, published: 0, review: 0, draft: 0 },
  );

  return (
    <>
      <OwnerPageHeader
        title="Content CMS"
        description="Everything the Learner App teaches from: written here, reviewed here, published from here."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Content CMS" }]}
      />

      {/* Each block answers for itself. The overview reads four different endpoints behind
          four different permissions, and one refusal should not blank the other three. */}
      {analytics.isError ? (
        <div className="mb-5">
          <LiveDataState error={analytics.error} onRetry={() => void analytics.refetch()} />
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {analytics.isPending
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              : [
                  { label: "Published", value: totals.published, hint: "live for learners now", icon: Send },
                  { label: "In review", value: totals.review, hint: "waiting to be checked", icon: PencilRuler },
                  { label: "Drafts", value: totals.draft, hint: "not visible to anyone yet", icon: FileStack },
                  {
                    label: "Questions",
                    value: questions.data?.total ?? 0,
                    // The question bank sits behind its own permission, so an analyst who
                    // can see content may legitimately not see this number.
                    hint: questions.isError ? "not visible to your account" : "in the question bank",
                    icon: SpellCheck,
                  },
                ].map((card) => (
                  <article key={card.label} className="grid min-w-0 gap-2 rounded-xl border bg-surface p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-label text-fg-muted">{card.label}</h3>
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-active text-fg-muted">
                        <card.icon className="size-3.5" aria-hidden />
                      </span>
                    </div>
                    <p className="text-h2 tabular-nums">{formatNumber(card.value)}</p>
                    <p className="truncate text-caption text-fg-muted">{card.hint}</p>
                  </article>
                ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
            <SectionCard title="By type" description="What exists, and how much of it learners can reach">
              {analytics.isPending ? (
                <Skeleton className="h-48" />
              ) : byType.length === 0 ? (
                <p className="py-8 text-center text-body-sm text-fg-muted">Nothing has been created yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {byType.map((row) => {
                    // Reading/listening/etc. have a page of their own; anything else is
                    // reachable through the full table with the same filter.
                    const href = isContentType(row.type)
                      ? `/owner/content/${row.type}`
                      : "/owner/content/all";
                    return (
                      <li key={row.type}>
                        <Link
                          href={href}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors duration-micro hover:bg-surface-hover"
                        >
                          <span className="truncate text-body-sm capitalize">{row.type.replace(/_/g, " ")}</span>
                          <span className="flex shrink-0 items-center gap-1.5 text-caption tabular-nums">
                            <Badge variant="success">{row.published} live</Badge>
                            {row.review > 0 && <Badge variant="outline">{row.review} review</Badge>}
                            {row.draft > 0 && <Badge variant="secondary">{row.draft} draft</Badge>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>

            <div className="grid gap-4">
              <SectionCard title="The lifecycle" description="What each status means to a learner">
                <ul className="grid gap-2.5">
                  {lifecycle.map((step) => (
                    <li key={step.status} className="grid gap-0.5">
                      <span className="text-body-sm">{step.label}</span>
                      <span className="text-caption text-fg-muted">{step.hint}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard
                title="Waiting for you"
                description="Unfinished and unchecked"
                action={
                  <Link href="/owner/content/all" className="text-label text-fg-muted hover:text-foreground">
                    All content <ArrowRight className="inline size-3.5" aria-hidden />
                  </Link>
                }
              >
                {drafts.isError || review.isError ? (
                  <LiveDataState error={drafts.error ?? review.error} onRetry={() => void drafts.refetch()} />
                ) : drafts.isPending || review.isPending ? (
                  <Skeleton className="h-24" />
                ) : (
                  <ul className="grid gap-2">
                    {[...(review.data?.items ?? []), ...(drafts.data?.items ?? [])].slice(0, 6).map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-3 text-body-sm">
                        <span className="truncate">{row.title}</span>
                        <span className="shrink-0 text-caption text-fg-muted">
                          {row.status} · {formatDate(row.updated_at)}
                        </span>
                      </li>
                    ))}
                    {(review.data?.total ?? 0) + (drafts.data?.total ?? 0) === 0 && (
                      <li className="py-4 text-center text-body-sm text-fg-muted">
                        Nothing unfinished. Everything is either published or archived.
                      </li>
                    )}
                  </ul>
                )}
              </SectionCard>

              <SectionCard
                title="Grammar library"
                description={grammar.isPending ? "…" : `${formatNumber(grammar.data?.total ?? 0)} topics`}
                action={
                  <Link href="/owner/content/grammar" className="text-label text-fg-muted hover:text-foreground">
                    Open <ArrowRight className="inline size-3.5" aria-hidden />
                  </Link>
                }
              >
                {grammar.isError ? (
                  <LiveDataState error={grammar.error} onRetry={() => void grammar.refetch()} />
                ) : (
                  <p className="text-body-sm text-fg-secondary">
                    Grammar has its own editor because a topic is more than a passage: it carries relationships,
                    practice questions and an explanation per language.
                  </p>
                )}
              </SectionCard>
            </div>
          </div>
        </>
      )}
    </>
  );
}
