"use client";

import { AlertTriangle, ArrowLeft, Check, Eye, Languages, Pencil, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { ActionMenu, ConfirmDialog, KeyValue, OwnerPageHeader, SectionCard } from "../components/primitives";
import {
  useGenerateGrammarContent,
  useGrammarContent,
  useGrammarValidation,
  usePublishGrammarContent,
  useRefineGrammarLevel,
  useSaveGrammarLevel,
  useTranslateGrammarLevel,
} from "../hooks";
import { formatDate } from "../lib/format";
import { cefrLevels, contentLanguageLabels, contentLanguages } from "../types";
import type {
  CEFRLevel,
  ContentLanguage,
  GrammarBody,
  LevelContent,
  LevelStatus,
  PracticeQuestion,
  ProposedLevel,
  RefineAction,
} from "../types";

/**
 * The Grammar Content Builder.
 *
 * One topic, six levels, three languages. The model writes a first draft of all applicable
 * levels in one call; the owner reads it, fixes it, previews what a learner would see, and
 * publishes. Nothing the model produces reaches a learner without that last step — an AI
 * that can publish is an AI that can teach something wrong to everyone at once.
 *
 * The editor is structured rather than one large text box, because the learner page renders
 * named sections and a free-text field would have to be parsed back into them. Editing the
 * same shape the page reads is the only way what you see here is what they get.
 */

const activeTab = "data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border";

const levelTone: Record<LevelStatus, string> = {
  published: "bg-success/15 text-success",
  draft: "bg-warning/20 text-warning-foreground",
  review: "bg-warning/20 text-warning-foreground",
  archived: "bg-surface-active text-fg-muted",
  not_applicable: "bg-surface-active text-fg-disabled line-through",
  not_created: "bg-surface-active text-fg-muted",
};

export function GrammarBuilderView({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const [language, setLanguage] = useState<ContentLanguage>(
    (contentLanguages as readonly string[]).includes(params.get("lang") ?? "")
      ? (params.get("lang") as ContentLanguage)
      : "en",
  );
  const [level, setLevel] = useState<CEFRLevel>("B1");
  const [tab, setTab] = useState("editor");
  const [generating, setGenerating] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const content = useGrammarContent(slug, language);
  const validation = useGrammarValidation(slug, language);
  const generate = useGenerateGrammarContent(slug);
  const publish = usePublishGrammarContent(slug);

  if (content.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (content.isError || !content.data) {
    return (
      <>
        <OwnerPageHeader
          title="Grammar topic"
          breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Grammar", href: "/owner/content/grammar" }]}
        />
        <LiveDataState error={content.error} onRetry={() => void content.refetch()} />
      </>
    );
  }

  const data = content.data;
  const current = data.levels.find((entry) => entry.level === level) ?? data.levels[0]!;
  const issues = validation.data?.issues ?? [];
  const written = data.levels.filter((entry) => entry.status !== "not_created" && entry.status !== "not_applicable");
  const live = data.levels.filter((entry) => entry.status === "published");

  function runGenerate(levels: CEFRLevel[], overwrite: boolean) {
    generate.mutate(
      { language, levels, overwrite },
      {
        onSuccess: () => {
          toast({ title: "Draft written", description: "Read it before publishing.", variant: "success" });
          setGenerating(false);
        },
        onError: (error) => {
          // A refusal to overwrite hand-written work is not a failure; it is the guard
          // asking a second time.
          if (isApiError(error) && error.status === 409) {
            const levelsInDetail = (error.details?.levels as string[] | undefined) ?? [];
            toast({
              title: "This would replace content you edited",
              description: `${levelsInDetail.join(", ")} was written by hand. Use "Replace anyway" to overwrite it.`,
              variant: "error",
            });
            return;
          }
          toast({
            title: "AI content generation failed",
            description: isApiError(error) ? error.message : "Please try again.",
            variant: "error",
          });
        },
      },
    );
  }

  return (
    <>
      <OwnerPageHeader
        title={data.topic.name}
        description={data.topic.description}
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Content CMS", href: "/owner/content" },
          { label: "Grammar", href: "/owner/content/grammar" },
          { label: data.topic.name },
        ]}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => router.push("/owner/content/grammar")}>
              <ArrowLeft aria-hidden />
              Grammar Map
            </Button>
            <Button variant="outline" size="sm" loading={generate.isPending} onClick={() => setGenerating(true)}>
              <Sparkles aria-hidden />
              Generate with AI
            </Button>
            <Button size="sm" disabled={written.length === 0} onClick={() => setPublishOpen(true)}>
              <Send aria-hidden />
              Publish
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <SectionCard title="Basic information" description="Comes from the curriculum; you do not retype it">
          <dl className="grid sm:grid-cols-2">
            <KeyValue label="Topic">{data.topic.name}</KeyValue>
            <KeyValue label="Category">{data.topic.category_name ?? "—"}</KeyValue>
            <KeyValue label="Curriculum level">{data.topic.level ?? "—"}</KeyValue>
            <KeyValue label="Practice">
              {current.question_count > 0 ? `${current.question_count} questions at ${current.level}` : "None yet"}
            </KeyValue>
          </dl>
          {data.related.length > 0 && (
            <p className="mt-3 text-caption text-fg-muted">
              Learners confuse this with {data.related.join(", ")} — the model is told, so it can contrast them.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Where this stands" description={`${live.length} of ${written.length || 6} levels live`}>
          <div className="grid gap-2">
            <LanguageSwitch value={language} onChange={setLanguage} />
            <ul className="grid gap-1 text-caption">
              {data.levels.map((entry) => (
                <li key={entry.level} className="flex items-center justify-between gap-2">
                  <span className="tabular-nums">{entry.level}</span>
                  <span className={cn("rounded px-1.5 py-0.5", levelTone[entry.status])}>
                    {entry.status.replace(/_/g, " ")}
                    {entry.status !== "not_created" && entry.version > 0 ? ` · v${entry.version}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>
      </div>

      {issues.length > 0 && (
        <div className="mb-5 grid gap-1.5 rounded-xl border border-warning/40 bg-warning-subtle/40 p-4">
          <p className="flex items-center gap-2 text-body-sm font-medium">
            <AlertTriangle className="size-4 text-warning" aria-hidden />
            {issues.length} {issues.length === 1 ? "issue" : "issues"} found
          </p>
          <ul className="grid gap-0.5 text-caption text-fg-secondary">
            {issues.map((issue, index) => (
              <li key={`${issue.level}-${issue.field}-${index}`}>· {issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* The level being edited. Switching it changes the text, not just a label — that is
          the whole point of writing a topic six times. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {cefrLevels.map((code) => {
          const entry = data.levels.find((item) => item.level === code);
          const selected = code === level;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLevel(code)}
              aria-pressed={selected}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-body-sm transition-colors duration-micro",
                selected ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "hover:bg-surface-hover",
              )}
            >
              {code}
              <span className={cn("rounded px-1 text-[0.625rem]", levelTone[entry?.status ?? "not_created"])}>
                {(entry?.status ?? "not_created").replace(/_/g, " ")}
              </span>
            </button>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="editor" className={activeTab}>
            <Pencil className="size-4" aria-hidden />
            Editor
          </TabsTrigger>
          <TabsTrigger value="preview" className={activeTab}>
            <Eye className="size-4" aria-hidden />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <LevelEditor key={`${language}-${current.level}-${current.version}`} slug={slug} language={language} content={current} />
        </TabsContent>

        <TabsContent value="preview">
          <LearnerPreview topic={data.topic.name} level={current.level} language={language} content={current} />
        </TabsContent>
      </Tabs>

      <GenerateDialog
        open={generating}
        onOpenChange={setGenerating}
        levels={data.levels}
        language={language}
        loading={generate.isPending}
        onGenerate={runGenerate}
      />

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={`Publish ${data.topic.name}?`}
        description={
          issues.length > 0
            ? `${issues.length} ${issues.length === 1 ? "issue has" : "issues have"} to be fixed first. Publishing is refused until they are.`
            : `${written.length} level${written.length === 1 ? "" : "s"} in ${contentLanguageLabels[language]} go live. Learners on other levels keep whatever is published for them.`
        }
        confirmLabel="Publish"
        loading={publish.isPending}
        onConfirm={() => {
          publish.mutate(
            { language },
            {
              onSuccess: () => toast({ title: "Published", description: "Learners can read it now.", variant: "success" }),
              onError: (error) =>
                toast({
                  title: "Publishing was refused",
                  description: isApiError(error) ? error.message : undefined,
                  variant: "error",
                }),
            },
          );
          setPublishOpen(false);
        }}
      />
    </>
  );
}

function LanguageSwitch({ value, onChange }: { value: ContentLanguage; onChange: (next: ContentLanguage) => void }) {
  return (
    <div className="flex rounded-lg border p-0.5" role="group" aria-label="Content language">
      {contentLanguages.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          aria-pressed={value === code}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-caption font-medium transition-colors duration-micro",
            value === code ? "bg-surface-active text-foreground" : "text-fg-muted hover:text-foreground",
          )}
        >
          {contentLanguageLabels[code]}
        </button>
      ))}
    </div>
  );
}

/**
 * One level's text, in the same named sections the learner page renders.
 *
 * Saving never edits a published row: it writes the next version, and learners keep reading
 * the one that was reviewed until somebody publishes this one. The banner says so, because
 * an editor who thinks their change is live is an editor who stops checking.
 */
function LevelEditor({ slug, language, content }: { slug: string; language: ContentLanguage; content: LevelContent }) {
  const save = useSaveGrammarLevel(slug);
  const refine = useRefineGrammarLevel(slug);
  const translate = useTranslateGrammarLevel(slug);
  const body = content.body ?? {};

  const [title, setTitle] = useState(content.title);
  const [summary, setSummary] = useState(content.summary);
  const [intro, setIntro] = useState(body.intro ?? "");
  const [explanation, setExplanation] = useState(body.explanation ?? "");
  const [usage, setUsage] = useState<string[]>(body.usage ?? []);
  const [signalWords, setSignalWords] = useState<string[]>(body.signal_words ?? []);
  const [formulas, setFormulas] = useState(body.formulas ?? []);
  const [examples, setExamples] = useState(body.examples ?? []);
  const [mistakes, setMistakes] = useState(body.common_mistakes ?? []);
  const [questions, setQuestions] = useState<PracticeQuestion[]>(content.questions ?? []);
  /** Which section is waiting on the model, so only that card shows it is busy. */
  const [pending, setPending] = useState<string | null>(null);

  const notApplicable = content.status === "not_applicable";

  /**
   * Applies what the model proposed to the section that was asked for, and nothing else.
   *
   * The API sends the whole level back, because that is the shape the model answers in. If
   * it ignored the instruction and rewrote the rest as well, this is where that stops
   * mattering: an editor who asked for better examples keeps their explanation.
   */
  function applyProposal(section: string, proposed: ProposedLevel) {
    const next = proposed.body ?? {};
    switch (section) {
      case "intro":
        setIntro(next.intro ?? "");
        break;
      case "explanation":
        setExplanation(next.explanation ?? "");
        break;
      case "usage":
        setUsage(next.usage ?? []);
        break;
      case "signal_words":
        setSignalWords(next.signal_words ?? []);
        break;
      case "formulas":
        setFormulas(next.formulas ?? []);
        break;
      case "examples":
        setExamples(next.examples ?? []);
        break;
      case "common_mistakes":
        setMistakes(next.common_mistakes ?? []);
        break;
      case "practice":
        setQuestions(proposed.practice ?? []);
        break;
      default:
        // No section named: the whole level was rewritten (Improve, Adapt, Translate).
        setTitle(proposed.title);
        setSummary(proposed.summary);
        setIntro(next.intro ?? "");
        setExplanation(next.explanation ?? "");
        setUsage(next.usage ?? []);
        setSignalWords(next.signal_words ?? []);
        setFormulas(next.formulas ?? []);
        setExamples(next.examples ?? []);
        setMistakes(next.common_mistakes ?? []);
        setQuestions(proposed.practice ?? []);
    }
  }

  function runRefine(section: string, action: RefineAction, adaptFrom?: string) {
    setPending(section || "level");
    refine.mutate(
      { level: content.level, input: { language, action, section: section || undefined, adapt_from: adaptFrom } },
      {
        onSuccess: (proposed) => {
          applyProposal(section, proposed);
          toast({
            title: section ? "Proposed — review it and save" : "Rewritten — review it and save",
            description: "Nothing is saved until you press Save draft.",
          });
        },
        onError: (error) =>
          toast({
            title: "The model could not do that",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
        onSettled: () => setPending(null),
      },
    );
  }

  /**
   * Translating the approved English into the language being edited.
   *
   * Not the same as generating in that language, which is what Generate does: a translation
   * says what the English says. When an editor has decided what a topic teaches, the other
   * languages should agree with that decision rather than make their own.
   */
  function runTranslate() {
    setPending("translate");
    translate.mutate(
      { level: content.level, input: { from: "en", to: language } },
      {
        onSuccess: (proposed) => {
          applyProposal("", proposed);
          toast({
            title: "Translated — review it and save",
            description: "Nothing is saved until you press Save draft.",
          });
        },
        onError: (error) =>
          toast({
            title: "It could not be translated",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
        onSettled: () => setPending(null),
      },
    );
  }

  function persist(status?: string) {
    const next: GrammarBody = {
      intro,
      explanation,
      usage,
      signal_words: signalWords,
      formulas,
      examples,
      common_mistakes: mistakes,
    };
    save.mutate(
      { level: content.level, input: { language, title, summary, body: next, status, questions } },
      {
        onSuccess: () => toast({ title: "Saved as a draft", variant: "success" }),
        onError: (error) =>
          toast({
            title: "It could not be saved",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
      },
    );
  }

  if (notApplicable) {
    return (
      <SectionCard
        title={`${content.level} is marked not applicable`}
        description="A decision, not a gap"
        action={
          <Button variant="outline" size="sm" loading={save.isPending} onClick={() => persist("draft")}>
            Write it anyway
          </Button>
        }
      >
        <p className="text-body-sm text-fg-secondary">
          {content.summary || "This topic is not worth teaching at this level."}
        </p>
        <p className="mt-2 text-caption text-fg-muted">
          The Grammar Map counts this level as settled rather than as work still to do.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="grid gap-4">
      {content.published_version !== null && content.version !== content.published_version && (
        <p className="rounded-lg border border-warning/40 bg-warning-subtle/40 px-4 py-2.5 text-caption">
          Learners are reading version {content.published_version}. This is version {content.version}, and it stays a
          draft until you publish.
        </p>
      )}

      <SectionCard
        title={`${content.level} content`}
        description={`${contentLanguageLabels[language]} · version ${content.version || 1} · ${content.source === "ai" ? "written by AI, unreviewed" : "edited by hand"}`}
        action={
          <span className="flex flex-wrap items-center gap-1">
            <SectionAI
              section=""
              busy={pending}
              onRun={(_, action) => runRefine("", action)}
              actions={[{ action: "improve", label: "Improve with AI" }]}
            />
            <AdaptMenu level={content.level} busy={pending} onAdapt={(from) => runRefine("", "adapt", from)} />
            {language !== "en" && (
              <Button variant="ghost" size="sm" disabled={pending !== null} loading={pending === "translate"} onClick={runTranslate}>
                <Languages aria-hidden /> Translate from English
              </Button>
            )}
            <Button size="sm" loading={save.isPending} onClick={() => persist()}>
              Save draft
            </Button>
          </span>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="level-title">Title</Label>
              <Input id="level-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="level-summary">Short description</Label>
              <Input id="level-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={600} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <span className="flex items-center justify-between gap-2">
              <Label htmlFor="level-intro">What is it?</Label>
              <SectionAI
                section="intro"
                busy={pending}
                onRun={runRefine}
                actions={[{ action: "regenerate", label: "Rewrite" }]}
              />
            </span>
            <Textarea id="level-intro" rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <span className="flex items-center justify-between gap-2">
              <Label htmlFor="level-explanation">When do we use it?</Label>
              <SectionAI
                section="explanation"
                busy={pending}
                onRun={runRefine}
                actions={[{ action: "regenerate", label: "Rewrite" }]}
              />
            </span>
            <Textarea id="level-explanation" rows={5} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </div>

          <StringList
            label="Usage rules"
            value={usage}
            onChange={setUsage}
            placeholder="Talking about experience"
            action={
              <SectionAI
                section="usage"
                busy={pending}
                onRun={runRefine}
                actions={[{ action: "expand", label: "Add more" }]}
              />
            }
          />
          <StringList
            label="Signal words"
            value={signalWords}
            onChange={setSignalWords}
            placeholder="already, yet, since"
            action={
              <SectionAI
                section="signal_words"
                busy={pending}
                onRun={runRefine}
                actions={[{ action: "expand", label: "Add more" }]}
              />
            }
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Formulas"
        description="Affirmative, negative, question"
        action={
          <SectionAI
            section="formulas"
            busy={pending}
            onRun={runRefine}
            actions={[{ action: "regenerate", label: "Regenerate" }, { action: "expand", label: "Add more" }]}
          />
        }
      >
        <RowList
          rows={formulas}
          onChange={setFormulas}
          blank={{ label: "", pattern: "", examples: [] }}
          addLabel="Add a formula"
          render={(row, update) => (
            <>
              <Input
                aria-label="Label"
                placeholder="Affirmative"
                value={row.label}
                onChange={(e) => update({ ...row, label: e.target.value })}
              />
              <Input
                aria-label="Pattern"
                placeholder="subject + have/has + past participle"
                value={row.pattern}
                onChange={(e) => update({ ...row, pattern: e.target.value })}
                className="sm:col-span-2"
              />
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        title="Examples"
        description="Sentences somebody would actually say"
        action={
          <SectionAI
            section="examples"
            busy={pending}
            onRun={runRefine}
            actions={[{ action: "regenerate", label: "Regenerate examples" }, { action: "expand", label: "Add more" }]}
          />
        }
      >
        <RowList
          rows={examples}
          onChange={setExamples}
          blank={{ text: "", note: "" }}
          addLabel="Add an example"
          render={(row, update) => (
            <>
              <Input
                aria-label="Example"
                placeholder="I have finished my homework."
                value={row.text}
                onChange={(e) => update({ ...row, text: e.target.value })}
                className="sm:col-span-2"
              />
              <Input
                aria-label="Note"
                placeholder="What it shows"
                value={row.note ?? ""}
                onChange={(e) => update({ ...row, note: e.target.value })}
              />
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        title="Common mistakes"
        description="The wrong form, the right form, and why"
        action={
          <SectionAI
            section="common_mistakes"
            busy={pending}
            onRun={runRefine}
            actions={[{ action: "regenerate", label: "Regenerate" }, { action: "expand", label: "Add more" }]}
          />
        }
      >
        <RowList
          rows={mistakes}
          onChange={setMistakes}
          blank={{ wrong: "", right: "", why: "", rule: "" }}
          addLabel="Add a mistake"
          render={(row, update) => (
            <>
              <Input
                aria-label="Wrong"
                placeholder="I have went"
                value={row.wrong}
                onChange={(e) => update({ ...row, wrong: e.target.value })}
              />
              <Input
                aria-label="Right"
                placeholder="I have gone"
                value={row.right}
                onChange={(e) => update({ ...row, right: e.target.value })}
              />
              <Input
                aria-label="Why"
                placeholder="'Gone' is the past participle."
                value={row.why}
                onChange={(e) => update({ ...row, why: e.target.value })}
              />
            </>
          )}
        />
      </SectionCard>

      <SectionCard
        title="Practice"
        description={`${questions.length} ${questions.length === 1 ? "question" : "questions"} · multiple choice`}
        action={
          <SectionAI
            section="practice"
            busy={pending}
            onRun={runRefine}
            actions={[
              { action: "expand", label: "Generate more" },
              { action: "regenerate", label: "Regenerate all" },
            ]}
          />
        }
      >
        <PracticeEditor questions={questions} onChange={setQuestions} />
      </SectionCard>
    </div>
  );
}

/**
 * The questions, edited next to the text they test.
 *
 * They used to be reachable only from the Question Bank, which meant writing a lesson and
 * writing its practice were two visits to two pages — and the second one was easy to forget.
 * Published questions are not shown here: learners may be part-way through them, and a draft
 * edit is not a publication. They are replaced when the topic is published.
 */
function PracticeEditor({
  questions,
  onChange,
}: {
  questions: PracticeQuestion[];
  onChange: (next: PracticeQuestion[]) => void;
}) {
  const update = (index: number, next: PracticeQuestion) =>
    onChange(questions.map((q, i) => (i === index ? next : q)));

  return (
    <div className="grid gap-4">
      {questions.length === 0 && (
        <p className="rounded-lg border border-dashed py-6 text-center text-body-sm text-fg-muted">
          No practice yet. Ask the model for some, or write one.
        </p>
      )}

      {questions.map((raw, index) => {
        // Defended rather than assumed: this list arrives from the API, and a question that
        // lost its options should be fixable here, not a blank page.
        const question: PracticeQuestion = { ...raw, options: raw.options ?? [] };
        const answerOutOfRange = question.answer_index < 0 || question.answer_index >= question.options.length;
        return (
          <div key={index} className="grid gap-3 rounded-lg border bg-surface p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-caption text-fg-muted tabular-nums">{index + 1}</span>
              <Textarea
                aria-label={`Question ${index + 1}`}
                rows={2}
                value={question.prompt}
                placeholder="She ___ in London since 2019."
                onChange={(event) => update(index, { ...question, prompt: event.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove question ${index + 1}`}
                onClick={() => onChange(questions.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>

            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-caption text-fg-muted">Options — select the correct one</legend>
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`answer-${index}`}
                    aria-label={`Option ${optionIndex + 1} is correct`}
                    checked={question.answer_index === optionIndex}
                    onChange={() => update(index, { ...question, answer_index: optionIndex })}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <Input
                    aria-label={`Option ${optionIndex + 1}`}
                    value={option}
                    onChange={(event) =>
                      update(index, {
                        ...question,
                        options: question.options.map((o, i) => (i === optionIndex ? event.target.value : o)),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove option ${optionIndex + 1}`}
                    disabled={question.options.length <= 2}
                    onClick={() => {
                      const options = question.options.filter((_, i) => i !== optionIndex);
                      // The correct answer follows its option rather than staying on an index
                      // that now points at a different one.
                      let answer = question.answer_index;
                      if (optionIndex < answer) answer -= 1;
                      else if (optionIndex === answer) answer = 0;
                      update(index, { ...question, options, answer_index: answer });
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              ))}
              {question.options.length < 6 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => update(index, { ...question, options: [...question.options, ""] })}
                >
                  <Plus aria-hidden /> Add an option
                </Button>
              )}
              {answerOutOfRange && (
                <p className="text-caption text-error">Pick which option is correct — none is selected.</p>
              )}
            </fieldset>

            <Input
              aria-label={`Why option is correct, question ${index + 1}`}
              placeholder="Why the answer is right"
              value={question.explanation ?? ""}
              onChange={(event) => update(index, { ...question, explanation: event.target.value })}
            />
          </div>
        );
      })}

      <Button
        variant="outline"
        className="justify-self-start"
        onClick={() =>
          onChange([...questions, { prompt: "", options: ["", ""], answer_index: 0, explanation: "", target_rule: "" }])
        }
      >
        <Plus aria-hidden /> Add a question
      </Button>
    </div>
  );
}

/**
 * Rewriting this level from another one.
 *
 * "Adapt to B2" only makes sense when there is a B2 to adapt from, so the menu offers the
 * levels rather than a free-text box, and the direction is stated in full: you are on B1,
 * and you are taking the B2 draft down to it.
 */
function AdaptMenu({
  level,
  busy,
  onAdapt,
}: {
  level: string;
  busy: string | null;
  onAdapt: (from: string) => void;
}) {
  const others = cefrLevels.filter((code) => code !== level);
  return (
    <ActionMenu
      label={`Adapt ${level} from another level`}
      items={others.map((code) => ({
        label: `Adapt from ${code}`,
        icon: Sparkles,
        disabled: busy !== null,
        onSelect: () => onAdapt(code),
      }))}
    />
  );
}


/**
 * The AI actions for one section.
 *
 * Deliberately small and deliberately next to the thing they change: "Regenerate examples"
 * means the examples under it, and an editor should never have to work out which part of the
 * page a button at the top applies to. Nothing here saves — every action is a proposal.
 */
function SectionAI({
  section,
  actions,
  busy,
  onRun,
}: {
  section: string;
  actions: { action: RefineAction; label: string }[];
  busy: string | null;
  onRun: (section: string, action: RefineAction) => void;
}) {
  const pending = busy === section;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {actions.map(({ action, label }) => (
        <Button
          key={action}
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          loading={pending}
          onClick={() => onRun(section, action)}
        >
          <Sparkles aria-hidden />
          {label}
        </Button>
      ))}
    </span>
  );
}

/** A list of plain strings — usage rules, signal words. */
function StringList({
  label,
  value,
  onChange,
  placeholder,
  action,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {action}
      </span>
      <div className="grid gap-1.5">
        {value.map((entry, index) => (
          <div key={index} className="flex gap-1.5">
            <Input
              aria-label={`${label} ${index + 1}`}
              value={entry}
              placeholder={placeholder}
              onChange={(e) => onChange(value.map((item, i) => (i === index ? e.target.value : item)))}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label} ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
            <Plus aria-hidden />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A list of structured rows, each edited through the fields the caller renders. */
function RowList<T>({
  rows,
  onChange,
  blank,
  addLabel,
  render,
}: {
  rows: T[];
  onChange: (next: T[]) => void;
  blank: T;
  addLabel: string;
  render: (row: T, update: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div className="grid gap-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <div className="grid flex-1 gap-1.5 sm:grid-cols-3">
            {render(row, (next) => onChange(rows.map((item, i) => (i === index ? next : item))))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove row ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      {rows.length === 0 && <p className="text-caption text-fg-muted">Nothing yet.</p>}
      <div>
        <Button variant="outline" size="sm" onClick={() => onChange([...rows, blank])}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * What a learner would see.
 *
 * Rendered from the same fields the learner page reads, in the same order, so switching
 * from A1 to C1 here shows the real difference between the two — not a label change over
 * identical text, which is the failure this preview exists to catch.
 */
function LearnerPreview({
  topic,
  level,
  language,
  content,
}: {
  topic: string;
  level: CEFRLevel;
  language: ContentLanguage;
  content: LevelContent;
}) {
  const body = content.body ?? {};
  const empty =
    !body.intro &&
    !body.explanation &&
    (body.examples ?? []).length === 0 &&
    (body.formulas ?? []).length === 0;

  if (content.status === "not_applicable") {
    return (
      <SectionCard title="Nothing is shown at this level" description={`${level} · ${contentLanguageLabels[language]}`}>
        <p className="text-body-sm text-fg-secondary">
          {content.summary || "This topic is not taught at this level."} A learner at {level} is served the nearest
          level that does have content.
        </p>
      </SectionCard>
    );
  }

  if (empty) {
    return (
      <SectionCard title="Nothing written yet" description={`${level} · ${contentLanguageLabels[language]}`}>
        <p className="text-body-sm text-fg-muted">
          Generate a draft or write one, and this is where you will see it the way a learner does.
        </p>
      </SectionCard>
    );
  }

  return (
    <article className="grid gap-6 rounded-xl border bg-surface p-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{level}</Badge>
          <Badge variant="secondary">{contentLanguageLabels[language]}</Badge>
          {content.status === "published" ? (
            <Badge variant="success">Live</Badge>
          ) : (
            <Badge variant="outline">Not published</Badge>
          )}
        </div>
        <h2 className="text-h2">{content.title || topic}</h2>
        {content.summary && <p className="text-body text-fg-secondary">{content.summary}</p>}
      </header>

      {body.intro && (
        <section className="grid gap-2">
          <h3 className="text-h4">What is {topic}?</h3>
          <p className="whitespace-pre-wrap text-body text-fg-secondary">{body.intro}</p>
        </section>
      )}

      {body.explanation && (
        <section className="grid gap-2">
          <h3 className="text-h4">When do we use it?</h3>
          <p className="whitespace-pre-wrap text-body text-fg-secondary">{body.explanation}</p>
        </section>
      )}

      {(body.usage ?? []).length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-h4">Usage</h3>
          <ul className="grid gap-1.5">
            {(body.usage ?? []).map((entry, index) => (
              <li key={index} className="flex gap-2 text-body-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                {entry}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(body.formulas ?? []).length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-h4">Formula</h3>
          <div className="grid gap-2">
            {(body.formulas ?? []).map((formula, index) => (
              <div key={index} className="rounded-lg border bg-surface-subtle p-3">
                <p className="text-label text-fg-muted">{formula.label}</p>
                <p className="font-mono text-body-sm">{formula.pattern}</p>
                {formula.examples.length > 0 && (
                  <ul className="mt-1.5 grid gap-0.5 text-caption text-fg-secondary">
                    {formula.examples.map((example, i) => (
                      <li key={i}>{example}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(body.examples ?? []).length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-h4">Examples</h3>
          <ul className="grid gap-2">
            {(body.examples ?? []).map((example, index) => (
              <li key={index} className="grid gap-0.5">
                <span className="text-body">{example.text}</span>
                {example.note && <span className="text-caption text-fg-muted">{example.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(body.signal_words ?? []).length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-h4">Signal words</h3>
          <div className="flex flex-wrap gap-1.5">
            {(body.signal_words ?? []).map((word, index) => (
              <Badge key={index} variant="outline">
                {word}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {(body.common_mistakes ?? []).length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-h4">Common mistakes</h3>
          <ul className="grid gap-3">
            {(body.common_mistakes ?? []).map((mistake, index) => (
              <li key={index} className="grid gap-0.5 text-body-sm">
                <span>
                  <span className="text-error line-through">{mistake.wrong}</span>{" "}
                  <span className="text-success">{mistake.right}</span>
                </span>
                {mistake.why && <span className="text-caption text-fg-secondary">{mistake.why}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t pt-4 text-caption text-fg-muted">
        {content.question_count > 0
          ? `${content.question_count} practice questions follow this lesson.`
          : "No practice questions at this level yet."}
        {content.published_at ? ` · Published ${formatDate(content.published_at)}` : ""}
      </footer>
    </article>
  );
}

/**
 * What to write, and whether to overwrite.
 *
 * Levels that already carry hand-edited text are unticked to begin with: the common case is
 * filling the gaps, not replacing an afternoon's work. Overwriting is possible, once it has
 * been asked for explicitly.
 */
function GenerateDialog({
  open,
  onOpenChange,
  levels,
  language,
  loading,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  levels: LevelContent[];
  language: ContentLanguage;
  loading: boolean;
  onGenerate: (levels: CEFRLevel[], overwrite: boolean) => void;
}) {
  const untouched = levels.filter((level) => level.status === "not_created").map((level) => level.level);
  const [selected, setSelected] = useState<CEFRLevel[]>(untouched.length > 0 ? untouched : cefrLevels);
  const [overwrite, setOverwrite] = useState(false);

  const replacing = levels.filter(
    (level) => selected.includes(level.level) && level.source === "curated" && level.status !== "not_created",
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Generate with AI"
      description={`One request writes every level you pick, in ${contentLanguageLabels[language]}. Everything lands as a draft for you to read.`}
      confirmLabel={replacing.length > 0 && overwrite ? "Replace" : "Generate"}
      loading={loading}
      disabled={selected.length === 0 || (replacing.length > 0 && !overwrite)}
      onConfirm={() => onGenerate(selected, overwrite)}
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {cefrLevels.map((code) => {
            const picked = selected.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() =>
                  setSelected(picked ? selected.filter((item) => item !== code) : [...selected, code])
                }
                aria-pressed={picked}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-body-sm transition-colors duration-micro",
                  picked ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "hover:bg-surface-hover",
                )}
              >
                {code}
              </button>
            );
          })}
        </div>
        <p className="text-caption text-fg-muted">
          The model decides which of these the topic is actually worth teaching at, and says so for the rest instead of
          inventing a version that is wrong.
        </p>

        {replacing.length > 0 && (
          <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle/40 p-3">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span className="grid gap-0.5 text-caption">
              <span className="font-medium">
                This will replace the current content in {replacing.map((level) => level.level).join(", ")}
              </span>
              <span className="text-fg-muted">Those levels were edited by hand.</span>
            </span>
          </label>
        )}
      </div>
    </ConfirmDialog>
  );
}
