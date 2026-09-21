"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { useCreateQuestion, useQuestion, useUpdateQuestion } from "../hooks";
import type {
  AssessmentSkill,
  CEFRLevel,
  QuestionInput,
  QuestionItemType,
  QuestionOption,
} from "../types";
import { assessmentSkills, cefrLevels, objectiveItemTypes, questionItemTypes } from "../types";

/**
 * Authoring one question.
 *
 * The form mirrors what the API will accept, so the rules are visible while typing rather than
 * arriving as a rejection: an objective question needs at least two options and a key that
 * names one of them, a task carries neither. The server validates the same rules again — this
 * is a convenience, not the guarantee.
 */

const typeLabels: Record<QuestionItemType, string> = {
  multiple_choice: "Multiple choice",
  true_false_not_given: "True / False / Not given",
  vocabulary_in_context: "Vocabulary in context",
  writing_task: "Writing task",
  speaking_task: "Speaking task",
};

const skillLabels: Record<AssessmentSkill, string> = {
  reading: "Reading",
  listening: "Listening",
  writing: "Writing",
  speaking: "Speaking",
};

const emptyOption = (index: number): QuestionOption => ({ id: String.fromCharCode(97 + index), text: "" });

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function QuestionEditor({ questionId, onClose }: { questionId: string | null; onClose: () => void }) {
  const existing = useQuestion(questionId);
  const create = useCreateQuestion();
  const update = useUpdateQuestion();

  const loading = questionId !== null && existing.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{questionId ? "Edit question" : "New question"}</DialogTitle>
          <DialogDescription>
            {questionId
              ? "Changes apply to assessments started from now on. Published items keep their recorded results."
              : "Questions are created as drafts. Publish when the answer key is right."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : existing.isError ? (
          <LiveDataState error={existing.error} onRetry={() => void existing.refetch()} />
        ) : (
          <EditorForm
            initial={existing.data}
            saving={create.isPending || update.isPending}
            onSubmit={(input) => {
              const mutation = questionId
                ? update.mutateAsync({ id: questionId, input })
                : create.mutateAsync(input);
              void mutation
                .then(() => {
                  toast({ title: questionId ? "Question saved" : "Question created", variant: "success" });
                  onClose();
                })
                .catch((error: unknown) =>
                  toast({
                    title: "The question was not saved",
                    description: isApiError(error) ? error.message : undefined,
                    variant: "error",
                  }),
                );
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  initial,
  saving,
  onSubmit,
  onCancel,
}: {
  initial?: {
    slug: string;
    skill: AssessmentSkill;
    level: CEFRLevel;
    difficulty: number;
    topic: string;
    item_type: QuestionItemType;
    prompt: string;
    options: QuestionOption[];
    answer_key: { option_id?: string } | null;
    explanation: string;
  };
  saving: boolean;
  onSubmit: (input: QuestionInput) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [skill, setSkill] = useState<AssessmentSkill>(initial?.skill ?? "reading");
  const [level, setLevel] = useState<CEFRLevel>(initial?.level ?? "B1");
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? 5);
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [itemType, setItemType] = useState<QuestionItemType>(initial?.item_type ?? "multiple_choice");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [options, setOptions] = useState<QuestionOption[]>(
    initial?.options?.length ? initial.options : [emptyOption(0), emptyOption(1)],
  );
  const [answerId, setAnswerId] = useState(initial?.answer_key?.option_id ?? "");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");

  const objective = objectiveItemTypes.includes(itemType);
  const effectiveSlug = slugTouched ? slug : slugify(prompt);

  const problems: string[] = [];
  if (effectiveSlug.length < 3) problems.push("A slug of at least three characters is required.");
  if (prompt.trim().length === 0) problems.push("The prompt cannot be empty.");
  if (objective) {
    const filled = options.filter((o) => o.id.trim() && o.text.trim());
    if (filled.length < 2) problems.push("An objective question needs at least two complete options.");
    if (new Set(filled.map((o) => o.id)).size !== filled.length) problems.push("Option ids must be unique.");
    if (!answerId) problems.push("Choose which option is correct.");
    else if (!filled.some((o) => o.id === answerId)) problems.push("The correct option must be one of the options.");
  }

  function submit() {
    const input: QuestionInput = {
      slug: effectiveSlug,
      skill,
      level,
      difficulty,
      topic: topic.trim(),
      item_type: itemType,
      prompt: prompt.trim(),
      explanation: explanation.trim(),
      options: objective ? options.filter((o) => o.id.trim() && o.text.trim()) : [],
      answer_key: objective ? { option_id: answerId } : null,
    };
    onSubmit(input);
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (problems.length === 0) submit();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="q-prompt">Prompt</Label>
        <Textarea
          id="q-prompt"
          rows={3}
          value={prompt}
          placeholder="What does the writer suggest about remote work?"
          onChange={(event) => setPrompt(event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="q-slug">Slug</Label>
          <Input
            id="q-slug"
            value={effectiveSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(slugify(event.target.value));
            }}
          />
          <p className="text-caption text-fg-muted">Stable id used by seeds and authoring tools.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="q-type">Question type</Label>
          <NativeSelect
            id="q-type"
            value={itemType}
            onChange={(event) => setItemType(event.target.value as QuestionItemType)}
          >
            {questionItemTypes.map((type) => (
              <option key={type} value={type}>
                {typeLabels[type]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-caption text-fg-muted">
            {objective ? "Marked from the answer key — no AI involved." : "Evaluated by AI against a rubric."}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="q-skill">Skill</Label>
          <NativeSelect id="q-skill" value={skill} onChange={(event) => setSkill(event.target.value as AssessmentSkill)}>
            {assessmentSkills.map((s) => (
              <option key={s} value={s}>
                {skillLabels[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="q-level">CEFR level</Label>
          <NativeSelect id="q-level" value={level} onChange={(event) => setLevel(event.target.value as CEFRLevel)}>
            {cefrLevels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="q-difficulty">Difficulty (1–10)</Label>
          <Input
            id="q-difficulty"
            type="number"
            min={1}
            max={10}
            value={difficulty}
            onChange={(event) => setDifficulty(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="q-topic">Topic</Label>
          <Input id="q-topic" value={topic} placeholder="travel" onChange={(event) => setTopic(event.target.value)} />
        </div>
      </div>

      {objective && (
        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="px-1 text-label">Options and answer key</legend>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Option ${index + 1} id`}
                value={option.id}
                className="w-16"
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((o, i) => (i === index ? { ...o, id: event.target.value.trim() } : o)),
                  )
                }
              />
              <Input
                aria-label={`Option ${index + 1} text`}
                value={option.text}
                placeholder="Answer text"
                onChange={(event) =>
                  setOptions((current) => current.map((o, i) => (i === index ? { ...o, text: event.target.value } : o)))
                }
              />
              <button
                type="button"
                aria-label={`Mark option ${option.id || index + 1} as correct`}
                aria-pressed={answerId === option.id}
                onClick={() => setAnswerId(option.id)}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-md border transition-colors duration-micro",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  answerId === option.id && option.id
                    ? "border-success bg-success/15 text-success"
                    : "text-fg-muted hover:bg-surface-hover",
                )}
              >
                <Check className="size-4" aria-hidden />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove option ${index + 1}`}
                disabled={options.length <= 2}
                onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setOptions((current) => [...current, emptyOption(current.length)])}
          >
            <Plus aria-hidden />
            Add option
          </Button>
          <p className="text-caption text-fg-muted">
            The ticked option is the answer key. Learners never receive it.
          </p>
        </fieldset>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="q-explanation">Explanation</Label>
        <Textarea
          id="q-explanation"
          rows={2}
          value={explanation}
          placeholder="Shown after the assessment to explain why the answer is right."
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>

      {problems.length > 0 && (
        <ul className="grid gap-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={problems.length > 0}>
          Save question
        </Button>
      </DialogFooter>
    </form>
  );
}
