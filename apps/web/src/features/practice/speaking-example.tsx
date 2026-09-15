"use client";

import type { EvaluationResult } from "@engora/types";
import { ArrowLeft, ArrowRight, Info, ThumbsUp, TrendingUp, Volume2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader, SectionTitle } from "@/components/common/page-header";
import { AIProcessingState } from "@/components/learning/ai-processing";
import { MistakeCard, RecommendationCard, ScoreCard } from "@/components/learning/cards";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Example of the speaking analysis report, rendered from an EvaluationResult with the
 * exact shape the API will return. Clearly labelled as an example.
 */
const example: EvaluationResult = {
  schema_version: "evaluation.v1",
  model_version: "example",
  prompt_version: "example",
  rubric_version: "ielts_speaking.v1",
  analysis_version: "example",
  score: 6.5,
  scale: "ielts_band",
  scores: { fluency_coherence: 7.0, lexical_resource: 6.5, grammatical_range_accuracy: 6.0, pronunciation: 6.5 },
  mistakes: [
    { category: "grammar.tense.past_simple", original: "Last summer I go to Samarkand with my family.", correction: "Last summer I went to Samarkand with my family.", explanation: "Use the past simple for finished actions at a specific past time.", severity: "medium" },
    { category: "grammar.articles", original: "It is very beautiful city.", correction: "It is a very beautiful city.", explanation: "Singular countable nouns need an article.", severity: "low" },
  ],
  strengths: ["You kept talking for the full time with few long pauses.", "Good use of linking words: however, also, because.", "Clear structure: introduction, details and a conclusion."],
  recommendations: [
    { type: "grammar_topic", target: "past-simple", reason: "Past tense errors appeared three times." },
    { type: "practice_skill", target: "speaking", reason: "Practise narrating past events." },
  ],
};

const criteria: { key: string; label: string }[] = [
  { key: "fluency_coherence", label: "Fluency & Coherence" },
  { key: "lexical_resource", label: "Lexical Resource" },
  { key: "grammatical_range_accuracy", label: "Grammatical Range & Accuracy" },
  { key: "pronunciation", label: "Pronunciation" },
];

export function SpeakingExampleReport() {
  const [showProcessing, setShowProcessing] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
        <Link href="/app/speaking">
          <ArrowLeft aria-hidden /> Back to speaking
        </Link>
      </Button>
      <PageHeader
        title="Your Speaking Analysis"
        description="Topic: Describe your hometown"
        actions={
          <Button variant="outline" onClick={() => setShowProcessing((v) => !v)} aria-expanded={showProcessing}>
            {showProcessing ? "Hide processing preview" : "Preview processing state"}
          </Button>
        }
      />

      <Alert variant="info" className="mb-8">
        <Info />
        <AlertDescription>
          This is an example report with illustrative data. Your own analysis will appear in this format after you submit a recording.
        </AlertDescription>
      </Alert>

      {showProcessing && <AIProcessingState className="mb-8" autoAdvanceMs={1400} />}

      <section aria-label="Scores" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <ScoreCard label="Estimated IELTS Band" score={example.score} scale="ielts_band" size="hero" caption="Estimate for practice — not an official IELTS score." />
        <div className="grid gap-4 sm:grid-cols-2">
          {criteria.map((c) => (
            <ScoreCard key={c.key} label={c.label} score={example.scores[c.key] ?? null} scale="ielts_band" />
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="well-title">
          <SectionTitle id="well-title" title="What you did well" />
          <ul className="grid gap-2">
            {example.strengths.map((s) => (
              <li key={s} className="flex gap-3 rounded-lg border bg-surface p-4 text-body-sm">
                <ThumbsUp className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="improve-title">
          <SectionTitle id="improve-title" title="Areas to improve" />
          <ul className="grid gap-2">
            {["Use past tenses consistently when describing past events.", "Add articles before singular nouns.", "Vary your adjectives instead of repeating “very beautiful”."].map((s) => (
              <li key={s} className="flex gap-3 rounded-lg border bg-surface p-4 text-body-sm">
                <TrendingUp className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="grammar-title" className="mt-10">
        <SectionTitle id="grammar-title" title="Grammar mistakes" />
        <div className="grid gap-4 md:grid-cols-2">
          {example.mistakes.map((m) => (
            <MistakeCard key={m.original} category={m.category} original={m.original} correction={m.correction} explanation={m.explanation} severity={m.severity} />
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="vocab-title">
          <SectionTitle id="vocab-title" title="Vocabulary suggestions" />
          <ul className="divide-y rounded-xl border bg-surface">
            {[
              ["very beautiful", "stunning, picturesque"],
              ["a lot of people", "crowds of visitors"],
              ["good food", "delicious local dishes"],
            ].map(([from, to]) => (
              <li key={from} className="flex flex-wrap items-center gap-2 px-5 py-3 text-body-sm">
                <span className="text-fg-muted">{from}</span>
                <ArrowRight className="size-3.5 text-fg-muted" aria-hidden />
                <span className="font-medium">{to}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="pron-title">
          <SectionTitle id="pron-title" title="Pronunciation issues" />
          <ul className="divide-y rounded-xl border bg-surface">
            {[
              ["think", "/θɪŋk/", "Put your tongue between your teeth for /θ/."],
              ["develop", "/dɪˈveləp/", "Stress the second syllable."],
            ].map(([word, ipa, tip]) => (
              <li key={word} className="flex items-start gap-3 px-5 py-3">
                <Volume2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="grid gap-0.5">
                  <p className="text-body-sm font-medium">
                    {word} <span className="font-mono font-normal text-fg-muted">{ipa}</span>
                  </p>
                  <p className="text-caption text-fg-muted">{tip}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="next-title" className="mt-10">
        <SectionTitle id="next-title" title="Recommended next practice" />
        <div className="grid gap-4 sm:grid-cols-2">
          <RecommendationCard title="Past Simple" skill="grammar" reason={example.recommendations[0]!.reason} href="/app/grammar" />
          <RecommendationCard title="Talk about a memorable trip" skill="speaking" reason={example.recommendations[1]!.reason} href="/app/speaking" />
        </div>
      </section>
    </>
  );
}
