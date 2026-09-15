"use client";

import type { ListeningExerciseBody } from "@engora/types";
import { Eye, EyeOff, Headphones, Info } from "lucide-react";
import { useState } from "react";

import { AudioPlayer } from "@/components/learning/audio-player";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useContentItem } from "@/features/learning/hooks";

import { ContentPicker, PracticeFrame, useContentSelection } from "./content-picker";
import { QuestionList } from "./questions";

export function ListeningView({ initialContentId }: { initialContentId?: string }) {
  const { list, items, current, select } = useContentSelection({ type: "listening_exercise" }, initialContentId);
  const item = useContentItem<ListeningExerciseBody>(current?.id);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showTranscript, setShowTranscript] = useState(false);
  const body = item.data?.body;
  const allAnswered = !!body && body.questions.every((q) => answers[q.id]);

  return (
    <PracticeFrame skill="listening" title="Listening practice" description="Listen, answer, then check the transcript." list={list} emptyTitle="No listening exercises yet">
      <div className="mx-auto grid max-w-2xl gap-6">
        <ContentPicker
          items={items}
          current={current}
          onSelect={(id) => {
            select(id);
            setAnswers({});
            setShowTranscript(false);
          }}
          label="Exercise"
        />

        <section aria-labelledby="exercise-title" className="grid gap-5 rounded-xl border bg-surface p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
              <Headphones className="size-5" aria-hidden />
            </span>
            <div>
              <h2 id="exercise-title" className="text-h3">
                {current?.title}
              </h2>
              {current?.level && <Badge variant="secondary">{current.level}</Badge>}
            </div>
          </div>
          <AudioPlayer key={current?.id} src={body?.audio_url ?? null} title={current?.title ?? "exercise"} />
          {body && !body.audio_url && (
            <Alert variant="info">
              <Info />
              <AlertDescription>Audio for this exercise is being produced. Meanwhile, you can reveal the transcript after answering.</AlertDescription>
            </Alert>
          )}
        </section>

        {body && (
          <section aria-labelledby="lq-title" className="grid gap-6 rounded-xl border bg-surface p-6">
            <h2 id="lq-title" className="text-h3">
              Questions
            </h2>
            <QuestionList questions={body.questions} answers={answers} onAnswer={(q, o) => setAnswers((a) => ({ ...a, [q]: o }))} />
          </section>
        )}

        {body?.transcript && (
          <section className="grid gap-3">
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() => setShowTranscript((v) => !v)}
              disabled={!allAnswered}
              aria-expanded={showTranscript}
              aria-controls="transcript"
            >
              {showTranscript ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {showTranscript ? "Hide transcript" : allAnswered ? "Show transcript" : "Answer all questions to see the transcript"}
            </Button>
            {showTranscript && (
              <p id="transcript" className="rounded-xl border bg-surface p-6 text-body leading-7 text-fg-secondary">
                {body.transcript}
              </p>
            )}
          </section>
        )}
      </div>
    </PracticeFrame>
  );
}
