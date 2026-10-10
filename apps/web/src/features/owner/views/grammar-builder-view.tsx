"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  BookOpen,
  Check,
  Eye,
  Languages,
  ListChecks,
  Mic,
  PenLine,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";

import { FlagGB, FlagRU, FlagUZ } from "@/components/common/flags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { formatDuration } from "@/lib/audio";
import { useNow } from "@/lib/clock";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import { ActionMenu, ConfirmDialog, KeyValue, OwnerPageHeader, SectionCard } from "../components/primitives";
import {
  useGrammarContent,
  useGrammarGeneration,
  useGrammarValidation,
  useDeleteGrammarContent,
  usePublishGrammarContent,
  useRefineGrammarLevel,
  useSaveGrammarLevel,
  useSaveGrammarTask,
  useTranslateGrammarLevel,
} from "../hooks";
import { formatDate } from "../lib/format";
import { cefrLevels, contentLanguageLabels, contentLanguages, generateParts } from "../types";
import type {
  CEFRLevel,
  ContentLanguage,
  GeneratePart,
  GrammarBody,
  LevelContent,
  PracticeKind,
  PracticeQuestion,
  PracticeTask,
  PracticeTaskKind,
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

const activeTab = "data-[state=active]:text-primary-text data-[state=active]:ring-1 data-[state=active]:ring-border";


export function GrammarBuilderView({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const [language, setLanguage] = useState<ContentLanguage>(
    (contentLanguages as readonly string[]).includes(params.get("lang") ?? "")
      ? (params.get("lang") as ContentLanguage)
      : // Uzbek first: it is what most learners read, so it is what the owner checks first.
        "uz",
  );
  const [level, setLevel] = useState<CEFRLevel>("B1");
  const [tab, setTab] = useState("editor");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  /** What was just asked for, shown as being written before the server has said "queued". */
  const [requested, setRequested] = useState<Writing>(null);

  const content = useGrammarContent(slug, language);
  const validation = useGrammarValidation(slug, language);
  const publish = usePublishGrammarContent(slug);
  const remove = useDeleteGrammarContent(slug);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const generation = useGrammarGeneration(slug, {
    onSucceeded: (job) => {
      const failed: string[] = job.result?.failed ?? [];
      // "test:B1" is a test the model could not write, "en:C2" a level it left empty, and
      // "uz:B1" a translation that did not come back. Each has its own fix.
      const tests = failed.filter((f) => f.startsWith("test:")).map((f) => f.slice(5));
      const empty = failed.filter((f) => f.startsWith("en:")).map((f) => f.slice(3));
      const tasks = failed.filter((f) => f.startsWith("writing:") || f.startsWith("speaking:"));
      const translations = failed.filter(
        (f) => !f.startsWith("test:") && !f.startsWith("en:") && !f.startsWith("writing:") && !f.startsWith("speaking:"),
      );
      const notes = [
        empty.length > 0 && `${empty.join(", ")} came back empty — generate ${empty.length === 1 ? "it" : "them"} again.`,
        translations.length > 0 &&
          `Some translations did not come back (${translations.join(", ")}) — use "Translate from English" there.`,
        tests.length > 0 && `The test for ${tests.join(", ")} could not be written — use "Generate more" on the Test tab.`,
        tasks.length > 0 && `Some tasks could not be written (${tasks.join(", ")}) — use "Regenerate" on their tab.`,
      ].filter(Boolean);
      toast({
        title: "Draft written",
        description: notes.length > 0 ? notes.join(" ") : "Everything you asked for is a draft now. Read it before publishing.",
        variant: notes.length > 0 ? "default" : "success",
      });
    },
    onFailed: () =>
      toast({ title: "AI content generation failed", description: "Nothing was changed. Please try again.", variant: "error" }),
  });
  /** Levels and languages the model is writing right now; their fields show placeholders. */
  const writing = generation.active
    ? {
        levels: generation.active.levels as CEFRLevel[],
        languages: generation.active.languages,
        parts: generation.active.parts,
      }
    : generation.start.isPending
      ? requested
      : null;

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
  /**
   * The explanation is one lesson stored at every level, so the Editor and the Preview show
   * one level's copy of it — the curriculum level's when it has one — and saving it updates
   * them all. The level only matters for the practice tabs.
   */
  const lesson =
    written.find((entry) => entry.level === data.topic.level) ??
    written[0] ??
    data.levels.find((entry) => entry.level === data.topic.level) ??
    current;
  const explaining =
    Boolean(writing) &&
    (!writing!.parts?.length || writing!.parts.includes("explanation")) &&
    writing!.languages.includes(language);
  const practiceTab = tab === "test" || tab === "writing" || tab === "speaking";
  // Live when any level has a version learners can read — published now, or behind a newer draft.
  const isLive = data.levels.some((entry) => entry.status === "published" || entry.published_version != null);
  const upToDate = isLive && data.unpublished === false;

  function runGenerate(levels: CEFRLevel[], overwrite: boolean, languages: ContentLanguage[], parts: GeneratePart[]) {
    // The dialog closes at once: the editor itself shows what is being written, field by
    // field, rather than a spinner in a modal that blocks the page for minutes.
    setDialogOpen(false);
    setRequested({ levels, languages, parts });
    if (!levels.includes(level)) setLevel(levels[0]!);
    generation.start.mutate(
      { languages, levels, overwrite, parts },
      {
        onError: (error) => {
          // A refusal to overwrite hand-written work is not a failure; it is the guard
          // asking a second time.
          if (isApiError(error) && error.status === 409) {
            const levelsInDetail = (error.details?.levels as string[] | undefined) ?? [];
            const inLanguage = error.details?.language as ContentLanguage | undefined;
            toast({
              title: "This would replace content you edited",
              description: `${levelsInDetail.join(", ")}${inLanguage ? ` (${contentLanguageLabels[inLanguage]})` : ""} was written by hand. Tick "replace" in Generate to overwrite it.`,
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
            {written.length > 0 && (
              <span
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium",
                  upToDate
                    ? "bg-success/15 text-success"
                    : isLive
                      ? "bg-warning/20 text-warning-text"
                      : "bg-surface-active text-fg-secondary",
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", upToDate ? "bg-success" : isLive ? "bg-warning" : "bg-fg-muted")} />
                {upToDate ? "Live for learners" : isLive ? "Live · unpublished changes" : "Draft — not live yet"}
              </span>
            )}
            {written.length > 0 && (
              <Button
                variant="ghost"
                className="h-9 text-error hover:bg-error/10 hover:text-error"
                disabled={Boolean(writing)}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}
            <Button variant="ghost" className="h-9" onClick={() => router.push("/owner/content/grammar")}>
              <ArrowLeft aria-hidden />
              Grammar
            </Button>
            {/* The AI action has its own look — a violet-to-green wash — so it reads as "the
                model writes this", not as one more neutral button beside Publish. */}
            <Button
              variant="subtle"
              className="h-9 border border-primary/35 bg-[linear-gradient(110deg,color-mix(in_oklch,oklch(0.64_0.17_295)_22%,transparent),color-mix(in_oklch,var(--primary)_22%,transparent))] px-4 text-foreground hover:brightness-110"
              loading={Boolean(writing)}
              onClick={() => setDialogOpen(true)}
            >
              <Sparkles aria-hidden className="text-primary" />
              {writing ? "Writing…" : "Generate with AI"}
            </Button>
            {/* Once everything is live there is nothing to publish: the button says so and
                waits until an edit or a generation leaves something new behind. */}
            {upToDate ? (
              <Button className="h-9 px-4" variant="outline" disabled title="Everything is live — edit or generate to publish again">
                <CheckCircle2 aria-hidden className="text-success" />
                Published
              </Button>
            ) : (
              <Button className="h-9 px-4" disabled={written.length === 0} onClick={() => setPublishOpen(true)}>
                <Send aria-hidden />
                Publish
              </Button>
            )}
          </>
        }
      />

      {writing && <GenerationProgress progress={generation.progress} parts={writing.parts} levels={writing.levels} startedAt={generation.active?.started_at} />}

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-stretch">
        <SectionCard title="Basic information" description="Comes from the curriculum; you do not retype it" className="h-full">
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

        <SectionCard title="Language" description="The explanation you are editing" className="h-full" bodyClassName="flex">
          <LanguageSwitch value={language} onChange={setLanguage} />
        </SectionCard>
      </div>

      {issues.length > 0 && (
        <div className="mb-5 grid gap-1.5 rounded-xl border border-warning/40 bg-warning-subtle/40 p-4">
          <p className="flex items-center gap-2 text-body-sm font-medium">
            <AlertTriangle className="size-4 text-warning-text" aria-hidden />
            {issues.length} {issues.length === 1 ? "issue" : "issues"} found
          </p>
          <ul className="grid gap-0.5 text-caption text-fg-secondary">
            {issues.map((issue, index) => (
              <li key={`${issue.level}-${issue.field}-${index}`}>· {issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="editor" className={activeTab}>
            <Pencil className="size-4" aria-hidden />
            Editor
          </TabsTrigger>
          <TabsTrigger value="test" className={activeTab}>
            <ListChecks className="size-4" aria-hidden />
            Test
            <span className="rounded bg-surface-active px-1 text-caption tabular-nums text-fg-muted">
              {current.questions?.length ?? 0}
            </span>
          </TabsTrigger>
          <TabsTrigger value="writing" className={activeTab}>
            <PenLine className="size-4" aria-hidden />
            Writing
            {taskOf(current, "writing")?.status === "draft" && <span className="size-1.5 rounded-full bg-warning" aria-label="draft" />}
          </TabsTrigger>
          <TabsTrigger value="speaking" className={activeTab}>
            <Mic className="size-4" aria-hidden />
            Speaking
            {taskOf(current, "speaking")?.status === "draft" && <span className="size-1.5 rounded-full bg-warning" aria-label="draft" />}
          </TabsTrigger>
          <TabsTrigger value="preview" className={activeTab}>
            <Eye className="size-4" aria-hidden />
            Preview
          </TabsTrigger>
        </TabsList>

        {/* The level whose practice is open. Only the practice changes with the level — the
            explanation is the same lesson for every one of them. */}
        {practiceTab ? (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-caption text-fg-muted">Practice for</span>
            {cefrLevels.map((code) => {
              const entry = data.levels.find((item) => item.level === code);
              const task = entry && tab !== "test" ? taskOf(entry, tab as "writing" | "speaking") : undefined;
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
                  {isWriting(writing, code, language, tab as GeneratePart) ? (
                    <WritingBadge compact />
                  ) : (
                    <span className="rounded bg-surface-active px-1 text-[0.625rem] text-fg-muted tabular-nums">
                      {tab === "test" ? `${entry?.question_count ?? 0} q` : (task?.status ?? "none")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-subtle/40 px-4 py-2.5 text-body-sm">
            <Badge variant="outline" className="border-primary/40 text-primary-subtle-foreground">
              A1–C2
            </Badge>
            One complete explanation for every level. Learners at every level read this same lesson; saving it updates all
            levels. Only the test, writing and speaking change with the level.
          </p>
        )}

        <TabsContent value="editor">
          {explaining ? (
            <WritingPlaceholder level={lesson.level} languages={writing!.languages} startedAt={generation.active?.started_at} />
          ) : (
            <LevelEditor key={`${language}-${lesson.level}-${lesson.version}`} slug={slug} language={language} content={lesson} />
          )}
        </TabsContent>

        <TabsContent value="test">
          {isWriting(writing, current.level, language, "test") ? (
            <WritingPlaceholder level={current.level} languages={writing!.languages} startedAt={generation.active?.started_at} />
          ) : (
            <TestEditor key={`${language}-${current.level}-${current.version}`} slug={slug} language={language} content={current} />
          )}
        </TabsContent>

        {(["writing", "speaking"] as const).map((kind) => (
          <TabsContent key={kind} value={kind}>
            {isWriting(writing, current.level, language, kind) ? (
              <WritingPlaceholder level={current.level} languages={["en"]} startedAt={generation.active?.started_at} />
            ) : (
              <TaskEditor
                key={`${kind}-${current.level}-${taskKey(current, kind)}`}
                slug={slug}
                kind={kind}
                content={current}
                busy={generation.generating}
                onRegenerate={() => runGenerate([current.level], false, ["en"], [kind])}
              />
            )}
          </TabsContent>
        ))}

        <TabsContent value="preview">
          {explaining ? (
            <WritingPlaceholder level={lesson.level} languages={writing!.languages} startedAt={generation.active?.started_at} />
          ) : (
            <LearnerPreview topic={data.topic.name} level={lesson.level} language={language} content={lesson} />
          )}
        </TabsContent>
      </Tabs>

      <GenerateDialog
        key={dialogOpen ? "open" : "closed"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        levels={data.levels}
        onGenerate={runGenerate}
      />

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={`Publish ${data.topic.name}?`}
        description={
          issues.length > 0
            ? `${issues.length} ${issues.length === 1 ? "issue has" : "issues have"} to be fixed first. Publishing is refused until they are.`
            : `The explanation and every level's practice go live in ${contentLanguages.map((code) => contentLanguageLabels[code]).join(", ")} together — every language that has a draft.`
        }
        confirmLabel="Publish"
        loading={publish.isPending}
        onConfirm={() => {
          publish.mutate(
            // All three at once: the topic was written in all three, and publishing only the
            // tab that happens to be open left the other languages as drafts nobody noticed.
            { languages: [...contentLanguages] },
            {
              onSuccess: () => toast({ title: "Published", description: "Learners can read it now.", variant: "success" }),
              onError: (error) => {
                // The refusal names the language of each issue ("Русский: B1 has no title"),
                // which this page cannot show for the tabs that are not open.
                const issues = isApiError(error)
                  ? ((error.details?.issues as { message: string }[] | undefined) ?? []).map((issue) => issue.message)
                  : [];
                toast({
                  title: "Publishing was refused",
                  description:
                    issues.length > 0
                      ? issues.slice(0, 3).join(" · ") + (issues.length > 3 ? ` · and ${issues.length - 3} more` : "")
                      : isApiError(error)
                        ? error.message
                        : undefined,
                  variant: "error",
                });
              },
            },
          );
          setPublishOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete everything written for ${data.topic.name}?`}
        description="The explanation in every language, the test questions, the writing and speaking tasks, the visuals and learners' progress on this topic are removed for good. If you delete it, it has to be created again from scratch. The topic itself stays in the curriculum as not created."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              setDeleteOpen(false);
              toast({ title: "Deleted", description: `${data.topic.name} is empty again — generate it to start over.`, variant: "success" });
            },
            onError: (error) =>
              toast({ title: "It could not be deleted", description: isApiError(error) ? error.message : undefined, variant: "error" }),
          })
        }
      />
    </>
  );
}

/** Uzbek, English, Russian — the order learners mostly read them in. */
const switchOrder: ContentLanguage[] = ["uz", "en", "ru"];
const languageFlags: Record<ContentLanguage, typeof FlagUZ> = { uz: FlagUZ, en: FlagGB, ru: FlagRU };

function LanguageSwitch({ value, onChange }: { value: ContentLanguage; onChange: (next: ContentLanguage) => void }) {
  return (
    <div className="grid flex-1 content-stretch gap-1.5" role="radiogroup" aria-label="Content language">
      {switchOrder.map((code) => {
        const Flag = languageFlags[code];
        const selected = value === code;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(code)}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-lg border px-3 text-left text-body-sm font-medium outline-none transition-colors duration-micro",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              selected
                ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
                : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Flag className="h-3.5 w-5" />
            <span className="flex-1">{contentLanguageLabels[code]}</span>
            <span className="text-caption uppercase opacity-70">{code}</span>
          </button>
        );
      })}
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
  const [exceptions, setExceptions] = useState(body.exceptions ?? []);
  /** Which section is waiting on the model, so only that card shows it is busy. */
  const [pending, setPending] = useState<string | null>(null);
  /** The one item being rewritten, as "section:index", so only that row shows it. */
  const [pendingItem, setPendingItem] = useState<string | null>(null);
  const busy = pending ?? pendingItem;

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
      case "exceptions":
        setExceptions(next.exceptions ?? []);
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
        setExceptions(next.exceptions ?? []);
    }
  }

  /**
   * Puts the model's replacement for one item into that one slot.
   *
   * The model answers with the whole list; only the item that was asked about is taken, so
   * the rest of the list — including anything edited here and not saved yet — stays as it is.
   */
  function applyItem(section: string, index: number, proposed: ProposedLevel) {
    const next = proposed.body ?? {};
    const pick = <T,>(list: T[] | undefined): T | undefined => list?.[index] ?? list?.[list.length - 1];
    const replace = <T,>(list: T[], item: T | undefined) =>
      item === undefined ? list : list.map((old, i) => (i === index ? item : old));
    switch (section) {
      case "usage":
        setUsage((list) => replace(list, pick(next.usage)));
        break;
      case "signal_words":
        setSignalWords((list) => replace(list, pick(next.signal_words)));
        break;
      case "formulas":
        setFormulas((list) => replace(list, pick(next.formulas)));
        break;
      case "examples":
        setExamples((list) => replace(list, pick(next.examples)));
        break;
      case "common_mistakes":
        setMistakes((list) => replace(list, pick(next.common_mistakes)));
        break;
      case "exceptions":
        setExceptions((list) => replace(list, pick(next.exceptions)));
        break;
    }
  }

  function runItem(section: string, index: number) {
    setPendingItem(`${section}:${index}`);
    refine.mutate(
      { level: content.level, input: { language, action: "regenerate_item", section, index } },
      {
        onSuccess: (proposed) => {
          applyItem(section, index, proposed);
          toast({ title: "Replaced — review it and save", description: "Nothing is saved until you press Save draft." });
        },
        onError: (error) =>
          toast({
            title: "The model could not do that",
            description: isApiError(error) ? error.message : undefined,
            variant: "error",
          }),
        onSettled: () => setPendingItem(null),
      },
    );
  }

  /** The props every list needs to offer "regenerate this one". */
  const itemAI = (section: string) => ({
    busy: busy !== null,
    regenerating: pendingItem?.startsWith(`${section}:`) ? Number(pendingItem.split(":")[1]) : null,
    onRegenerate: (index: number) => runItem(section, index),
  });

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
      exceptions,
      common_mistakes: mistakes,
    };
    save.mutate(
      // The test is saved from its own tab. Leaving questions out leaves them as they are.
      { level: content.level, input: { language, title, summary, body: next, status } },
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
          The Grammar page counts this level as settled rather than as work still to do.
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
        title={`Explanation · ${contentLanguageLabels[language]}`}
        description={`${contentLanguageLabels[language]} · version ${content.version || 1} · ${content.source === "ai" ? "written by AI, unreviewed" : "edited by hand"}`}
        action={
          <span className="flex flex-wrap items-center gap-1">
            <SectionAI
              section=""
              busy={busy}
              onRun={(_, action) => runRefine("", action)}
              actions={[{ action: "improve", label: "Improve with AI" }]}
            />
            <AdaptMenu level={content.level} busy={busy} onAdapt={(from) => runRefine("", "adapt", from)} />
            {language !== "en" && (
              <Button variant="ghost" size="sm" disabled={busy !== null} loading={pending === "translate"} onClick={runTranslate}>
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
                busy={busy}
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
                busy={busy}
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
            {...itemAI("usage")}
            placeholder="Talking about experience"
            action={
              <SectionAI
                section="usage"
                busy={busy}
                onRun={runRefine}
                actions={[{ action: "expand", label: "Add more" }]}
              />
            }
          />
          <StringList
            label="Signal words"
            value={signalWords}
            onChange={setSignalWords}
            {...itemAI("signal_words")}
            placeholder="already, yet, since"
            action={
              <SectionAI
                section="signal_words"
                busy={busy}
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
            busy={busy}
            onRun={runRefine}
            actions={[{ action: "regenerate", label: "Regenerate" }, { action: "expand", label: "Add more" }]}
          />
        }
      >
        <RowList
          rows={formulas}
          onChange={setFormulas}
          {...itemAI("formulas")}
          blank={{ label: "", pattern: "", examples: [] }}
          addLabel="Add a formula"
          display={(row) => (
            <div className="grid gap-0.5">
              <span className="text-caption text-fg-muted">{row.label}</span>
              <span className="font-mono text-body-sm">{row.pattern}</span>
            </div>
          )}
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
            busy={busy}
            onRun={runRefine}
            actions={[{ action: "regenerate", label: "Regenerate examples" }, { action: "expand", label: "Add more" }]}
          />
        }
      >
        <RowList
          rows={examples}
          onChange={setExamples}
          {...itemAI("examples")}
          blank={{ text: "", note: "" }}
          addLabel="Add an example"
          display={(row) => (
            <div className="grid gap-0.5">
              <span className="text-body-sm">{row.text}</span>
              {row.note && <span className="text-caption text-fg-muted">{row.note}</span>}
            </div>
          )}
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
        title="Exceptions"
        description="Where the topic breaks its own rule — irregular forms, verbs that never take it, fixed phrases"
        action={
          <SectionAI
            section="exceptions"
            busy={busy}
            onRun={runRefine}
            actions={[{ action: "regenerate", label: "Regenerate" }, { action: "expand", label: "Add more" }]}
          />
        }
      >
        <RowList
          rows={exceptions}
          onChange={setExceptions}
          {...itemAI("exceptions")}
          blank={{ rule: "", examples: [] }}
          addLabel="Add an exception"
          display={(row) => (
            <div className="grid gap-0.5 text-body-sm">
              <span>{row.rule}</span>
              {row.examples.length > 0 && <span className="text-caption text-fg-muted">{row.examples.join(" · ")}</span>}
            </div>
          )}
          render={(row, update) => (
            <>
              <Input
                aria-label="Exception"
                placeholder="Stative verbs (know, like) are not used in the continuous."
                value={row.rule}
                onChange={(e) => update({ ...row, rule: e.target.value })}
                className="sm:col-span-2"
              />
              <Input
                aria-label="Examples, separated by |"
                placeholder="I know him. | She likes tea."
                value={row.examples.join(" | ")}
                onChange={(e) =>
                  update({ ...row, examples: e.target.value.split("|").map((x) => x.trim()).filter(Boolean) })
                }
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
            busy={busy}
            onRun={runRefine}
            actions={[{ action: "regenerate", label: "Regenerate" }, { action: "expand", label: "Add more" }]}
          />
        }
      >
        <RowList
          rows={mistakes}
          onChange={setMistakes}
          {...itemAI("common_mistakes")}
          blank={{ wrong: "", right: "", why: "", rule: "" }}
          addLabel="Add a mistake"
          display={(row) => (
            <div className="grid gap-0.5 text-body-sm">
              <span>
                <span className="text-error line-through">{row.wrong}</span>{" "}
                <span className="text-success">{row.right}</span>
              </span>
              {row.why && <span className="text-caption text-fg-muted">{row.why}</span>}
            </div>
          )}
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

    </div>
  );
}

/** The size of a generated test; the owner can add as many more by hand as they like. */
const testSize = 15;

const kindLabels: Record<PracticeKind, string> = {
  multiple_choice: "Multiple choice",
  fill_blank: "Fill in the blank",
};

const kindOf = (q: PracticeQuestion): PracticeKind => q.type ?? "multiple_choice";

function blankQuestion(kind: PracticeKind): PracticeQuestion {
  return kind === "fill_blank"
    ? { type: kind, prompt: "", options: [], answer_index: -1, accepted: [""], hint: "", explanation: "", target_rule: "" }
    : { type: kind, prompt: "", options: ["", ""], answer_index: 0, accepted: [], hint: "", explanation: "", target_rule: "" };
}

/** What is wrong with a question that would stop it being marked, or null. */
function questionProblem(q: PracticeQuestion): string | null {
  if (!q.prompt.trim()) return "The question has no text yet.";
  if (kindOf(q) === "fill_blank") {
    const gaps = q.prompt.split("___").length - 1;
    if (gaps !== 1) return "Put exactly one ___ in the sentence, where the answer goes.";
    if (!(q.accepted ?? []).some((a) => a.trim())) return "Add at least one accepted answer.";
    return null;
  }
  if (q.options.length < 2) return "A multiple choice needs at least two options.";
  if (q.answer_index < 0 || q.answer_index >= q.options.length) return "Pick which option is correct.";
  return null;
}

/**
 * A level's test, on its own tab.
 *
 * Generate writes fifteen questions per level — most of them picked from options, some typed
 * into a gap — and this is where they are read, fixed, regenerated one at a time, or added
 * to by hand. Questions belong to the level, not to a language: the same test follows the
 * lesson in English, Uzbek and Russian, so editing it here edits it for all three.
 */
function TestEditor({ slug, language, content }: { slug: string; language: ContentLanguage; content: LevelContent }) {
  const save = useSaveGrammarLevel(slug);
  const refine = useRefineGrammarLevel(slug);
  const [questions, setQuestions] = useState<PracticeQuestion[]>(content.questions ?? []);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<number | null>(null);
  const busy = pending ?? (pendingItem !== null ? "item" : null);

  const gaps = questions.filter((q) => kindOf(q) === "fill_blank").length;
  const problems = questions.map(questionProblem).filter(Boolean).length;

  const failed = (title: string) => (error: unknown) =>
    toast({ title, description: isApiError(error) ? error.message : undefined, variant: "error" });

  function runRefine(_: string, action: RefineAction) {
    setPending("practice");
    refine.mutate(
      { level: content.level, input: { language, action, section: "practice" } },
      {
        onSuccess: (proposed) => {
          setQuestions(proposed.practice ?? []);
          toast({ title: "Proposed — review it and save", description: "Nothing is saved until you press Save test." });
        },
        onError: failed("The model could not do that"),
        onSettled: () => setPending(null),
      },
    );
  }

  function runItem(index: number) {
    setPendingItem(index);
    refine.mutate(
      { level: content.level, input: { language, action: "regenerate_item", section: "practice", index } },
      {
        onSuccess: (proposed) => {
          const list = proposed.practice ?? [];
          const item = list[index] ?? list[list.length - 1];
          if (item) setQuestions((all) => all.map((old, i) => (i === index ? item : old)));
          toast({ title: "Replaced — review it and save", description: "Nothing is saved until you press Save test." });
        },
        onError: failed("The model could not do that"),
        onSettled: () => setPendingItem(null),
      },
    );
  }

  function persist() {
    if (problems > 0) {
      toast({
        title: `${problems} ${problems === 1 ? "question needs" : "questions need"} fixing first`,
        description: "Each one says what is missing.",
        variant: "error",
      });
      return;
    }
    save.mutate(
      { level: content.level, input: { language, questions } },
      {
        onSuccess: () => toast({ title: "Test saved as a draft", description: "Learners get it when you publish.", variant: "success" }),
        onError: failed("The test could not be saved"),
      },
    );
  }

  if (content.status === "not_applicable" || content.status === "not_created") {
    return (
      <SectionCard
        title={`${content.level} test`}
        description={content.status === "not_applicable" ? "This level is marked not applicable" : "Nothing written yet"}
      >
        <p className="text-body-sm text-fg-secondary">
          {content.status === "not_applicable"
            ? "A level that is not taught has no test."
            : `Generate this level and its ${testSize}-question test is written with it.`}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={`${content.level} test`}
      description={`${questions.length} ${questions.length === 1 ? "question" : "questions"} · ${questions.length - gaps} multiple choice · ${gaps} fill in the blank · shared by every language`}
      action={
        <span className="flex flex-wrap items-center gap-1">
          <SectionAI
            section="practice"
            busy={busy}
            onRun={runRefine}
            actions={[
              { action: "expand", label: "Generate more" },
              { action: "regenerate", label: "Regenerate all" },
            ]}
          />
          <Button size="sm" loading={save.isPending} disabled={busy !== null} onClick={persist}>
            Save test
          </Button>
        </span>
      }
    >
      {questions.length > 0 && questions.length < testSize && (
        <p className="mb-3 rounded-lg border border-warning/40 bg-warning-subtle/40 px-3 py-2 text-caption">
          A full test is {testSize} questions; this one has {questions.length}. Generate more or add them by hand.
        </p>
      )}
      <PracticeEditor
        questions={questions}
        onChange={setQuestions}
        busy={busy !== null}
        regenerating={pendingItem}
        onRegenerate={runItem}
      />
    </SectionCard>
  );
}

/**
 * The questions of a test, each readable at a glance and editable in place.
 *
 * Two kinds. A multiple choice shows its options with the right one ticked; a fill in the
 * blank shows its sentence with the gap and the answers that count as right. Rows read as
 * text until Edit is pressed, the same as every other list in the builder.
 */
function PracticeEditor({
  questions,
  onChange,
  busy,
  regenerating,
  onRegenerate,
}: {
  questions: PracticeQuestion[];
  onChange: (next: PracticeQuestion[]) => void;
} & ItemAIProps) {
  const editing = useEditingRows();
  const update = (index: number, next: PracticeQuestion) =>
    onChange(questions.map((q, i) => (i === index ? next : q)));
  const add = (kind: PracticeKind) => {
    editing.add(questions.length);
    onChange([...questions, blankQuestion(kind)]);
  };

  return (
    <div className="grid gap-3">
      {questions.length === 0 && (
        <p className="rounded-lg border border-dashed py-6 text-center text-body-sm text-fg-muted">
          No test yet. Ask the model for one, or write the questions yourself.
        </p>
      )}

      {questions.map((raw, index) => {
        // Defended rather than assumed: this list arrives from the API, and a question that
        // lost its options should be fixable here, not a blank page.
        const question: PracticeQuestion = { ...raw, options: raw.options ?? [], accepted: raw.accepted ?? [] };
        const kind = kindOf(question);
        const problem = questionProblem(question);
        const open = editing.isOpen(index);
        const actions = (
          <ItemActions
            label={`question ${index + 1}`}
            editing={open}
            onEdit={() => editing.toggle(index)}
            regenerating={regenerating === index}
            busy={busy}
            onRegenerate={() => onRegenerate(index)}
            onRemove={() => {
              editing.removed(index);
              onChange(questions.filter((_, i) => i !== index));
            }}
          />
        );

        if (regenerating === index || !open) {
          return (
            <div key={index} className="flex items-start gap-2 rounded-lg border bg-surface py-2 pr-1 pl-3">
              <span className="mt-0.5 w-5 shrink-0 text-caption text-fg-muted tabular-nums">{index + 1}</span>
              <div className="min-w-0 flex-1">
                {regenerating === index ? (
                  <RowShimmer />
                ) : (
                  <div className="grid gap-1.5">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-body-sm">
                      <span>{question.prompt || emptyRow}</span>
                      <Badge variant="outline" className="text-[0.625rem]">
                        {kindLabels[kind]}
                      </Badge>
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {kind === "fill_blank"
                        ? question.accepted!.map((answer, i) => (
                            <li
                              key={i}
                              className="rounded-md border border-success/50 bg-success/10 px-2 py-0.5 text-caption text-success"
                            >
                              <Check className="mr-1 inline size-3" aria-hidden />
                              {answer || "—"}
                            </li>
                          ))
                        : question.options.map((option, optionIndex) => (
                            <li
                              key={optionIndex}
                              className={cn(
                                "rounded-md border px-2 py-0.5 text-caption",
                                optionIndex === question.answer_index
                                  ? "border-success/50 bg-success/10 text-success"
                                  : "text-fg-secondary",
                              )}
                            >
                              {optionIndex === question.answer_index && <Check className="mr-1 inline size-3" aria-hidden />}
                              {option || "—"}
                            </li>
                          ))}
                      {kind === "fill_blank" && question.hint && (
                        <li className="px-1 text-caption text-fg-muted">hint: {question.hint}</li>
                      )}
                    </ul>
                    {problem && <p className="text-caption text-error">{problem} Press edit to fix it.</p>}
                    {question.explanation && <p className="text-caption text-fg-muted">{question.explanation}</p>}
                  </div>
                )}
              </div>
              {actions}
            </div>
          );
        }

        return (
          <div key={index} className="grid gap-3 rounded-lg border bg-surface p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-caption text-fg-muted tabular-nums">{index + 1}</span>
              <div className="grid flex-1 gap-2">
                <div role="group" aria-label="Question type" className="flex flex-wrap gap-1">
                  {(["multiple_choice", "fill_blank"] as const).map((k) => (
                    <ToggleChip
                      key={k}
                      pressed={kind === k}
                      onToggle={() => {
                        if (k === kind) return;
                        // The prompt and explanation carry over; the answer fields are the new kind's.
                        const fresh = blankQuestion(k);
                        update(index, { ...fresh, prompt: question.prompt, explanation: question.explanation, target_rule: question.target_rule });
                      }}
                    >
                      {kindLabels[k]}
                    </ToggleChip>
                  ))}
                </div>
                <Textarea
                  aria-label={`Question ${index + 1}`}
                  rows={2}
                  value={question.prompt}
                  placeholder={kind === "fill_blank" ? "She ___ in London since 2019." : "Which sentence is correct?"}
                  onChange={(event) => update(index, { ...question, prompt: event.target.value })}
                />
              </div>
              {actions}
            </div>

            {kind === "fill_blank" ? (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-caption text-fg-muted">
                  Accepted answers — anything typed that matches one of these is right (case and final punctuation are ignored)
                </legend>
                {question.accepted!.map((answer, answerIndex) => (
                  <div key={answerIndex} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-success" aria-hidden />
                    <Input
                      aria-label={`Accepted answer ${answerIndex + 1}`}
                      value={answer}
                      placeholder="has lived"
                      onChange={(event) =>
                        update(index, {
                          ...question,
                          accepted: question.accepted!.map((a, i) => (i === answerIndex ? event.target.value : a)),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove accepted answer ${answerIndex + 1}`}
                      disabled={question.accepted!.length <= 1}
                      onClick={() =>
                        update(index, { ...question, accepted: question.accepted!.filter((_, i) => i !== answerIndex) })
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
                {question.accepted!.length < 8 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => update(index, { ...question, accepted: [...question.accepted!, ""] })}
                  >
                    <Plus aria-hidden /> Add another accepted answer
                  </Button>
                )}
                <Input
                  aria-label={`Hint, question ${index + 1}`}
                  placeholder="Hint shown in the box, e.g. (live) — optional"
                  value={question.hint ?? ""}
                  onChange={(event) => update(index, { ...question, hint: event.target.value })}
                />
              </fieldset>
            ) : (
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
              </fieldset>
            )}

            {problem && <p className="text-caption text-error">{problem}</p>}

            <Textarea
              aria-label={`Explanation, question ${index + 1}`}
              rows={2}
              placeholder="Why the right answer is right — and why the tempting wrong one is wrong. Learners see this after they answer."
              value={question.explanation ?? ""}
              onChange={(event) => update(index, { ...question, explanation: event.target.value })}
            />
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => add("multiple_choice")}>
          <Plus aria-hidden /> Add multiple choice
        </Button>
        <Button variant="outline" onClick={() => add("fill_blank")}>
          <Plus aria-hidden /> Add fill in the blank
        </Button>
      </div>
    </div>
  );
}

const taskOf = (content: LevelContent, kind: PracticeTaskKind) => content.tasks?.find((t) => t.kind === kind);

/** Changes when the stored task does, so the editor below reloads it after a save or a generate. */
const taskKey = (content: LevelContent, kind: PracticeTaskKind) => {
  const t = taskOf(content, kind);
  return t ? `${t.status}-${t.title}-${t.prompt.length}` : "none";
};

const taskCopy: Record<PracticeTaskKind, { title: string; empty: string; listLabel: string; listPlaceholder: string }> = {
  writing: {
    title: "Writing task",
    empty: "No writing task at this level yet.",
    listLabel: "What to include",
    listPlaceholder: "Use a or an before each new thing you mention.",
  },
  speaking: {
    title: "Speaking task",
    empty: "No speaking task at this level yet.",
    listLabel: "Points to talk about",
    listPlaceholder: "Say where it is and what it is like.",
  },
};

/**
 * A level's writing or speaking task, on its own tab.
 *
 * The learner who finishes the topic at this level is sent to write — or to speak — with
 * it, and this is the task they get. It is written with the topic, for the level, and goes
 * live when the topic is published. English only: it is what the learner does, not text
 * they read in their own language, so it is the same in every language tab.
 */
function TaskEditor({
  slug,
  kind,
  content,
  busy,
  onRegenerate,
}: {
  slug: string;
  kind: PracticeTaskKind;
  content: LevelContent;
  busy: boolean;
  onRegenerate: () => void;
}) {
  const save = useSaveGrammarTask(slug);
  const stored = taskOf(content, kind);
  const copy = taskCopy[kind];
  const [task, setTask] = useState<PracticeTask | null>(stored ?? null);
  const update = (patch: Partial<PracticeTask>) => setTask((t) => (t ? { ...t, ...patch } : t));

  if (content.status === "not_applicable") {
    return (
      <SectionCard title={`${content.level} ${copy.title.toLowerCase()}`} description="This level is marked not applicable">
        <p className="text-body-sm text-fg-secondary">A level that is not taught has no {kind} task.</p>
      </SectionCard>
    );
  }

  if (!task) {
    return (
      <SectionCard
        title={`${content.level} ${copy.title.toLowerCase()}`}
        description="Nothing written yet"
        action={
          <span className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={onRegenerate}>
              <Sparkles aria-hidden /> Generate for {content.level}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setTask({
                  kind, level: content.level, title: "", prompt: "", instructions: [""],
                  min_words: kind === "writing" ? 80 : 0, target_seconds: kind === "speaking" ? 60 : 0,
                  minutes: kind === "writing" ? 15 : 2, focus: "", status: "draft", source: "curated", live: false,
                })
              }
            >
              <Plus aria-hidden /> Write it yourself
            </Button>
          </span>
        }
      >
        <p className="text-body-sm text-fg-secondary">{copy.empty}</p>
      </SectionCard>
    );
  }

  const problem = !task.title.trim() ? "Give it a title." : task.prompt.trim().length < 5 ? "Write the task itself." : null;

  function persist() {
    if (!task || problem) {
      toast({ title: problem ?? "Nothing to save", variant: "error" });
      return;
    }
    save.mutate(
      {
        level: content.level,
        kind,
        input: {
          title: task.title, prompt: task.prompt, instructions: task.instructions.filter((i) => i.trim()),
          min_words: task.min_words, target_seconds: task.target_seconds, minutes: task.minutes, focus: task.focus,
        },
      },
      {
        onSuccess: () => toast({ title: `${copy.title} saved as a draft`, description: "Learners get it when you publish.", variant: "success" }),
        onError: (error) =>
          toast({ title: "It could not be saved", description: isApiError(error) ? error.message : undefined, variant: "error" }),
      },
    );
  }

  const state =
    task.status === "published" ? "live" : `draft${task.live ? " · a live version is behind it" : ""}`;
  return (
    <SectionCard
      title={`${content.level} ${copy.title.toLowerCase()}`}
      description={`English · ${state} · ${task.source === "ai" ? "written by AI, unreviewed" : "edited by hand"}`}
      action={
        <span className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onRegenerate}>
            <RefreshCw aria-hidden /> Regenerate
          </Button>
          <Button size="sm" loading={save.isPending} onClick={persist}>
            Save task
          </Button>
        </span>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${kind}-title`}>Title</Label>
          <Input id={`${kind}-title`} value={task.title} onChange={(e) => update({ title: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${kind}-prompt`}>Task — what the learner reads</Label>
          <Textarea id={`${kind}-prompt`} rows={3} value={task.prompt} onChange={(e) => update({ prompt: e.target.value })} />
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-label">{copy.listLabel}</legend>
          {task.instructions.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-caption text-fg-muted tabular-nums">{i + 1}</span>
              <Input
                aria-label={`${copy.listLabel} ${i + 1}`}
                value={line}
                placeholder={copy.listPlaceholder}
                onChange={(e) => update({ instructions: task.instructions.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => update({ instructions: task.instructions.filter((_, j) => j !== i) })}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
          {task.instructions.length < 8 && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => update({ instructions: [...task.instructions, ""] })}
            >
              <Plus aria-hidden /> Add a line
            </Button>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          {kind === "writing" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="task-words">Minimum words</Label>
              <Input
                id="task-words"
                type="number"
                min={0}
                max={1000}
                value={task.min_words}
                onChange={(e) => update({ min_words: Number(e.target.value) || 0 })}
              />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="task-seconds">Speak for (seconds)</Label>
              <Input
                id="task-seconds"
                type="number"
                min={0}
                max={600}
                value={task.target_seconds}
                onChange={(e) => update({ target_seconds: Number(e.target.value) || 0 })}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="task-minutes">Minutes</Label>
            <Input
              id="task-minutes"
              type="number"
              min={1}
              max={120}
              value={task.minutes}
              onChange={(e) => update({ minutes: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-1">
            <Label htmlFor="task-focus">Grammar focus</Label>
            <Input
              id="task-focus"
              value={task.focus}
              placeholder="This task practises a / an."
              onChange={(e) => update({ focus: e.target.value })}
            />
          </div>
        </div>
        {problem && <p className="text-caption text-error">{problem}</p>}
      </div>
    </SectionCard>
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

/** What every list needs to let one of its items be regenerated on its own. */
interface ItemAIProps {
  /** True while any AI action on this level is running. */
  busy: boolean;
  /** The index being regenerated right now, if it is in this list. */
  regenerating: number | null;
  onRegenerate: (index: number) => void;
}

/**
 * Which rows of a list are open for editing.
 *
 * Rows read as text until somebody presses Edit, so a long list scans like the lesson it is
 * rather than a wall of input boxes. A row added by hand opens straight away. Removing a row
 * shifts the open ones with it, so the box that stays open is the one you were typing in.
 */
function useEditingRows() {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  return {
    isOpen: (index: number) => open.has(index),
    toggle: (index: number) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      }),
    add: (index: number) => setOpen((current) => new Set(current).add(index)),
    removed: (index: number) =>
      setOpen((current) => new Set([...current].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)))),
  };
}

/** Edit, regenerate and remove — the same three controls at the end of every row. */
function ItemActions({
  label,
  editing,
  onEdit,
  regenerating,
  busy,
  onRegenerate,
  onRemove,
}: {
  label: string;
  editing: boolean;
  onEdit: () => void;
  regenerating: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onRemove: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon"
        aria-label={editing ? `Done editing ${label}` : `Edit ${label}`}
        aria-pressed={editing}
        disabled={regenerating}
        onClick={onEdit}
      >
        {editing ? <Check aria-hidden /> : <Pencil aria-hidden />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Regenerate ${label} with AI`}
        disabled={busy}
        onClick={onRegenerate}
      >
        <RefreshCw className={cn(regenerating && "animate-spin")} aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Remove ${label}`} disabled={regenerating} onClick={onRemove}>
        <Trash2 aria-hidden />
      </Button>
    </span>
  );
}

/** A row's text while the model rewrites it. */
function RowShimmer() {
  return (
    <div className="grid gap-1.5 py-0.5" aria-busy aria-label="Being rewritten by AI">
      <Skeleton className="h-4 w-11/12 rounded" />
      <Skeleton className="h-3 w-2/3 rounded" />
    </div>
  );
}

const emptyRow = <span className="text-caption text-fg-muted italic">Empty — press edit to write it</span>;

/** A list of plain strings — usage rules, signal words. */
function StringList({
  label,
  value,
  onChange,
  placeholder,
  action,
  busy,
  regenerating,
  onRegenerate,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  action?: ReactNode;
} & ItemAIProps) {
  const rows = useEditingRows();
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {action}
      </span>
      <div className="grid gap-1.5">
        {value.map((entry, index) => (
          <div key={index} className="flex items-center gap-1.5 rounded-lg border bg-surface py-1 pr-1 pl-3">
            <div className="min-w-0 flex-1">
              {regenerating === index ? (
                <RowShimmer />
              ) : rows.isOpen(index) ? (
                <Input
                  aria-label={`${label} ${index + 1}`}
                  value={entry}
                  placeholder={placeholder}
                  autoFocus
                  onChange={(e) => onChange(value.map((item, i) => (i === index ? e.target.value : item)))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rows.toggle(index);
                  }}
                />
              ) : (
                <p className="py-1.5 text-body-sm">{entry || emptyRow}</p>
              )}
            </div>
            <ItemActions
              label={`${label} ${index + 1}`}
              editing={rows.isOpen(index)}
              onEdit={() => rows.toggle(index)}
              regenerating={regenerating === index}
              busy={busy}
              onRegenerate={() => onRegenerate(index)}
              onRemove={() => {
                rows.removed(index);
                onChange(value.filter((_, i) => i !== index));
              }}
            />
          </div>
        ))}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              rows.add(value.length);
              onChange([...value, ""]);
            }}
          >
            <Plus aria-hidden />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A list of structured rows: read as text, edited through the fields the caller renders. */
function RowList<T>({
  rows,
  onChange,
  blank,
  addLabel,
  render,
  display,
  busy,
  regenerating,
  onRegenerate,
}: {
  rows: T[];
  onChange: (next: T[]) => void;
  blank: T;
  addLabel: string;
  render: (row: T, update: (next: T) => void) => React.ReactNode;
  display: (row: T) => React.ReactNode;
} & ItemAIProps) {
  const editing = useEditingRows();
  return (
    <div className="grid gap-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-1.5 rounded-lg border bg-surface py-1.5 pr-1 pl-3">
          <span className="mt-1.5 w-5 shrink-0 text-caption text-fg-muted tabular-nums">{index + 1}</span>
          <div className="min-w-0 flex-1 py-1">
            {regenerating === index ? (
              <RowShimmer />
            ) : editing.isOpen(index) ? (
              <div className="grid gap-1.5 sm:grid-cols-3">
                {render(row, (next) => onChange(rows.map((item, i) => (i === index ? next : item))))}
              </div>
            ) : (
              display(row)
            )}
          </div>
          <ItemActions
            label={`row ${index + 1}`}
            editing={editing.isOpen(index)}
            onEdit={() => editing.toggle(index)}
            regenerating={regenerating === index}
            busy={busy}
            onRegenerate={() => onRegenerate(index)}
            onRemove={() => {
              editing.removed(index);
              onChange(rows.filter((_, i) => i !== index));
            }}
          />
        </div>
      ))}
      {rows.length === 0 && <p className="text-caption text-fg-muted">Nothing yet.</p>}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            editing.add(rows.length);
            onChange([...rows, blank]);
          }}
        >
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
                <Check className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
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

      {(body.exceptions ?? []).length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-h4">Exceptions</h3>
          <ul className="grid gap-2">
            {(body.exceptions ?? []).map((item, index) => (
              <li key={index} className="grid gap-0.5 text-body-sm">
                <span>{item.rule}</span>
                {item.examples.length > 0 && <span className="text-caption text-fg-secondary">{item.examples.join(" · ")}</span>}
              </li>
            ))}
          </ul>
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
 * What to write, in which languages, and whether to overwrite.
 *
 * Levels that already carry hand-edited text are unticked to begin with: the common case is
 * filling the gaps, not replacing an afternoon's work. Overwriting is possible, once it has
 * been asked for explicitly. English is always written — it is what the other languages are
 * translated from, so all three teach the same thing.
 */
const levelState: Record<string, string> = {
  not_created: "new",
  not_applicable: "not taught",
  draft: "draft",
  review: "draft",
  published: "live",
  archived: "archived",
};

const partCards: { part: GeneratePart; icon: typeof Pencil; title: string; description: string }[] = [
  {
    part: "explanation",
    icon: BookOpen,
    title: "Full explanation",
    description: "One complete lesson for every level — rule, every form, exceptions, examples, mistakes. The test and tasks adapt to each level.",
  },
  {
    part: "test",
    icon: ListChecks,
    title: "Test · 15 per level",
    description: "Multiple choice and typed answers, checked before you see them.",
  },
  {
    part: "writing",
    icon: PenLine,
    title: "Writing task",
    description: "Something to write that needs this grammar, harder as the level rises.",
  },
  {
    part: "speaking",
    icon: Mic,
    title: "Speaking task",
    description: "Something to talk about — under a minute at A1, two at C2.",
  },
];

function GenerateDialog({
  open,
  onOpenChange,
  levels,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  levels: LevelContent[];
  onGenerate: (levels: CEFRLevel[], overwrite: boolean, languages: ContentLanguage[], parts: GeneratePart[]) => void;
}) {
  // Every level and every part is ticked to start with: one Generate writes the whole topic.
  const [selected, setSelected] = useState<CEFRLevel[]>([...cefrLevels]);
  const [languages, setLanguages] = useState<ContentLanguage[]>([...contentLanguages]);
  const [parts, setParts] = useState<GeneratePart[]>([...generateParts]);
  const [overwrite, setOverwrite] = useState(false);

  const explaining = parts.includes("explanation");
  const togglePart = (part: GeneratePart) =>
    setParts(parts.includes(part) ? parts.filter((p) => p !== part) : [...parts, part]);
  const toggleLevel = (code: CEFRLevel) =>
    setSelected(selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]);
  // Only a new explanation replaces hand-written text; a test or a task on its own does not.
  const replacing = explaining
    ? levels.filter(
        // A new explanation is written for every level, so a hand edit at any level is replaced.
        (level) => level.source === "curated" && level.status !== "not_created",
      )
    : [];
  const statusOf = (code: CEFRLevel) => levels.find((l) => l.level === code)?.status ?? "not_created";

  const summary =
    selected.length === 0 || parts.length === 0
      ? "Pick at least one level and one part"
      : `${selected.length} ${selected.length === 1 ? "level" : "levels"} · ${parts.length} ${parts.length === 1 ? "part" : "parts"}${
          explaining ? ` · ${languages.length} ${languages.length === 1 ? "language" : "languages"}` : ""
        }`;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      title="Generate with AI"
      description="The explanation is one full lesson for every level; the test and tasks are written for the levels you pick. Everything lands as a draft for you to read before it goes live."
      confirmLabel={replacing.length > 0 && overwrite ? "Replace and generate" : "Generate"}
      disabled={selected.length === 0 || parts.length === 0 || (replacing.length > 0 && !overwrite)}
      onConfirm={() => onGenerate(selected, overwrite, languages, parts)}
      footerStart={summary}
    >
      <div className="grid max-h-[60vh] gap-5 overflow-y-auto pr-1">
        <section className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label">Test, writing and speaking for</h3>
            <button
              type="button"
              className="text-caption font-medium text-primary hover:underline"
              onClick={() => setSelected(selected.length === cefrLevels.length ? [] : [...cefrLevels])}
            >
              {selected.length === cefrLevels.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {cefrLevels.map((code) => {
              const on = selected.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLevel(code)}
                  className={cn(
                    "grid justify-items-center gap-0.5 rounded-lg border px-2 py-2 outline-none transition-colors duration-micro",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    on ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "bg-surface hover:bg-surface-hover",
                  )}
                >
                  <span className="text-body font-semibold">{code}</span>
                  <span className={cn("text-[0.6875rem]", on ? "opacity-80" : "text-fg-muted")}>
                    {levelState[statusOf(code)] ?? statusOf(code)}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-caption text-fg-muted">
            The explanation is not tied to these: it is one complete lesson — rule, forms, exceptions, examples, mistakes — that
            every learner from A1 to C2 reads. Each level you pick gets its own test, writing and speaking task at that level.
          </p>
        </section>

        <section className="grid gap-2">
          <h3 className="text-label">What to write</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {partCards.map(({ part, icon: Icon, title, description }) => {
              const on = parts.includes(part);
              return (
                <div
                  key={part}
                  className={cn(
                    "grid content-start gap-2 rounded-xl border p-3 transition-colors duration-micro",
                    on ? "border-primary/60 bg-primary-subtle/40" : "bg-surface",
                    part === "explanation" && "sm:col-span-2",
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => togglePart(part)}
                    className="flex items-start gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-lg",
                        on ? "bg-primary text-primary-foreground" : "bg-surface-active text-fg-muted",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-body-sm font-medium">{title}</span>
                      <span className="text-caption text-fg-muted">{description}</span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {on && <Check className="size-3.5" />}
                    </span>
                  </button>
                  {part === "explanation" && on && (
                    <div className="flex flex-wrap items-center gap-1.5 border-t pt-2 pl-12">
                      <span className="mr-1 text-caption text-fg-muted">Languages</span>
                      {contentLanguages.map((code) => (
                        <ToggleChip
                          key={code}
                          pressed={languages.includes(code)}
                          // English is the source the others are translated from.
                          disabled={code === "en"}
                          onToggle={() =>
                            setLanguages(
                              languages.includes(code) ? languages.filter((item) => item !== code) : [...languages, code],
                            )
                          }
                        >
                          {contentLanguageLabels[code]}
                        </ToggleChip>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-caption text-fg-muted">
            The test and the tasks are in English and shared by every language; the explanation is written in English first
            and translated, so every language teaches the same thing.
          </p>
        </section>

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
                This will replace the explanation in {replacing.map((level) => level.level).join(", ")}
              </span>
              <span className="text-fg-muted">Those levels were edited by hand. Untick the explanation to keep them.</span>
            </span>
          </label>
        )}
      </div>
    </ConfirmDialog>
  );
}

function ToggleChip({
  pressed,
  disabled,
  onToggle,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-body-sm transition-colors duration-micro disabled:cursor-default",
        pressed ? "border-primary bg-primary-subtle text-primary-subtle-foreground" : "hover:bg-surface-hover",
      )}
    >
      {children}
    </button>
  );
}

type Writing = { levels: CEFRLevel[]; languages: ContentLanguage[]; parts?: GeneratePart[] } | null;

/**
 * Whether the model is writing this level right now — in this language, or, given a part,
 * that part of it. The test and the tasks are shared by every language, so for them the
 * language does not matter.
 */
function isWriting(writing: Writing, level: string, language: ContentLanguage, part?: GeneratePart) {
  if (!writing || !writing.levels.includes(level as CEFRLevel)) return false;
  const parts = writing.parts && writing.parts.length > 0 ? writing.parts : generateParts;
  if (part && !parts.includes(part)) return false;
  if (part && part !== "explanation") return true;
  if (!part && !parts.includes("explanation")) return true;
  return writing.languages.includes(language);
}

function WritingBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded bg-primary-subtle text-primary-subtle-foreground",
        compact ? "px-1 text-[0.625rem]" : "px-1.5 py-0.5",
      )}
    >
      <Sparkles className="size-3 animate-pulse" aria-hidden />
      writing
    </span>
  );
}

/**
 * The editor while the model is writing this level.
 *
 * The same sections the editor will have, so the owner sees the shape of what is coming and
 * where it will land — but alive rather than grey: each field types its lines out and starts
 * again, a light passes over the fields one after another, and a glint travels round the card
 * that is being written. The banner says which part the model is on and how long it has been.
 * All of it stops for anyone who has asked for reduced motion.
 */
function WritingPlaceholder({
  level,
  languages,
  startedAt,
}: {
  level: string;
  languages: ContentLanguage[];
  startedAt?: number;
}) {
  return (
    <div className="grid gap-4" aria-busy aria-live="polite">
      <WritingBanner level={level} languages={languages} startedAt={startedAt} />

      <WritingCard title="Explanation">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <WritingField label="Title" lines={1} seed={0} />
            <WritingField label="Short description" lines={1} seed={1} />
          </div>
          <WritingField label="What is it?" lines={2} seed={2} />
          <WritingField label="When do we use it?" lines={3} seed={4} />
          <WritingField label="Usage rules" lines={2} seed={7} />
        </div>
      </WritingCard>

      {(["Formulas", "Examples", "Common mistakes", "Practice"] as const).map((title, index) => (
        <WritingCard key={title} title={title} quiet>
          <div className="grid gap-2">
            {[0, 1, 2].map((row) => (
              <WritingField key={row} lines={1} seed={10 + index * 3 + row} numbered={row + 1} />
            ))}
          </div>
        </WritingCard>
      ))}
    </div>
  );
}

/**
 * How far a generation has got, as a percentage across the top of the page: the explanation,
 * each translation, each level's test and tasks are steps the worker reports as it finishes
 * them. Before the first report it shows 0% and keeps moving, rather than guessing.
 */
function GenerationProgress({
  progress,
  parts,
  levels,
  startedAt,
}: {
  progress: { done: number; total: number } | null;
  parts?: GeneratePart[];
  levels: CEFRLevel[];
  startedAt?: number;
}) {
  const now = useNow();
  const total = progress?.total ?? 0;
  const done = Math.min(progress?.done ?? 0, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const elapsed = startedAt && now > startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const what = (parts && parts.length > 0 ? parts : generateParts)
    .map((part) => ({ explanation: "explanation", test: "tests", writing: "writing", speaking: "speaking" })[part])
    .join(", ");

  return (
    <section
      role="status"
      aria-live="polite"
      className="relative mb-5 grid gap-3 overflow-hidden rounded-xl border border-primary/40 bg-surface p-4"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5" />
      <div className="relative flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4 animate-spin [animation-duration:2.4s]" aria-hidden />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-body font-medium">
            Generating with AI{" "}
            <span className="text-fg-muted">
              · {total > 0 ? `${done} of ${total} steps` : "starting"}
              {elapsed > 0 && ` · ${formatDuration(elapsed * 1000)}`}
            </span>
          </p>
          <p className="text-caption text-fg-muted">
            {what} · practice for {levels.join(", ")} · you can leave this page — it keeps going.
          </p>
        </div>
        <span className="text-h4 text-primary tabular-nums">{pct}%</span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-surface-active"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Generation progress"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
    </section>
  );
}

/** The step the model is on, cycling through what a generation actually does, and the time. */
function WritingBanner({
  level,
  languages,
  startedAt,
}: {
  level: string;
  languages: ContentLanguage[];
  startedAt?: number;
}) {
  const now = useNow();
  const steps = [
    `Reading the curriculum for ${level}`,
    "Writing the explanation",
    "Choosing examples a learner would actually say",
    "Collecting the mistakes learners make",
    "Writing practice questions",
    ...languages.filter((code) => code !== "en").map((code) => `Translating into ${contentLanguageLabels[code]}`),
  ];
  const elapsed = startedAt && now > startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const step = steps[Math.floor(elapsed / 4) % steps.length]!;

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-primary-subtle/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-primary/15">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-primary/20 motion-reduce:hidden" />
          <Sparkles className="relative size-4 text-primary-text" aria-hidden />
        </span>
        <div className="grid min-w-0 flex-1">
          {/* Keyed by the step so each new one fades in rather than swapping in place. */}
          <p key={step} className="truncate text-body-sm font-medium animate-in fade-in slide-in-from-bottom-1 duration-500">
            {step}…
          </p>
          <p className="text-caption text-fg-muted">
            {level} · {languages.map((code) => contentLanguageLabels[code]).join(", ")} · you can leave the page and
            come back
          </p>
        </div>
        {elapsed > 0 && (
          <span className="shrink-0 rounded-md bg-surface/70 px-2 py-0.5 text-caption text-fg-secondary tabular-nums">
            {formatDuration(elapsed * 1000)}
          </span>
        )}
      </div>
      {/* An indeterminate progress line: the model does not report how far it is, and a bar
          that pretends to know would be a lie that stalls at 90%. */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/10">
        <span className="absolute inset-y-0 left-0 w-1/3 animate-ai-sweep bg-gradient-to-r from-transparent via-primary to-transparent motion-reduce:hidden" />
      </span>
    </div>
  );
}

/** A section card with a glint travelling round its edge while it is being written. */
function WritingCard({ title, quiet = false, children }: { title: string; quiet?: boolean; children: ReactNode }) {
  return (
    <div className="relative rounded-[calc(var(--radius-xl)+1px)] p-px">
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 animate-ai-orbit rounded-[inherit] motion-reduce:hidden",
          "bg-[conic-gradient(from_var(--ai-angle),transparent_0deg,transparent_240deg,var(--primary)_320deg,transparent_360deg)]",
          quiet && "opacity-40",
        )}
      />
      <SectionCard title={title} description="Being written by AI" className="relative">
        {children}
      </SectionCard>
    </div>
  );
}

/** Widths the "typed" lines settle at: uneven, the way real lines of text are. */
const lineWidths = [88, 64, 93, 72, 81, 57, 90, 68, 77, 84, 61, 95];

/**
 * One field being written: its lines type themselves out left to right, a caret blinks at
 * the end of the last one, and a light passes over it. `seed` staggers the timing and the
 * widths so neighbouring fields are not in lockstep.
 */
function WritingField({
  label,
  lines,
  seed,
  numbered,
}: {
  label?: string;
  lines: number;
  seed: number;
  numbered?: number;
}) {
  const field = (
    <div className="relative flex items-start gap-2 overflow-hidden rounded-lg border border-primary/15 bg-surface-subtle px-3 py-2.5">
      {numbered !== undefined && (
        <span className="w-5 shrink-0 text-caption text-fg-muted tabular-nums">{numbered}</span>
      )}
      <div className="grid min-w-0 flex-1 gap-2 py-0.5">
        {Array.from({ length: lines }, (_, line) => (
          <div key={line} className="flex h-3 items-center gap-1">
            <span
              className="h-2.5 shrink-0 animate-ai-type rounded-full bg-gradient-to-r from-primary/50 via-primary/30 to-primary/15 motion-reduce:animate-none motion-reduce:w-[var(--ai-w)]"
              style={
                {
                  "--ai-w": `${lineWidths[(seed + line) % lineWidths.length]}%`,
                  animationDelay: `${((seed * 2 + line) % 9) * 160}ms`,
                } as CSSProperties
              }
            />
            {line === lines - 1 && (
              <span className="h-3.5 w-0.5 shrink-0 animate-ai-caret rounded-full bg-primary motion-reduce:animate-none" />
            )}
          </div>
        ))}
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-ai-sweep bg-gradient-to-r from-transparent via-primary/12 to-transparent motion-reduce:hidden"
        style={{ animationDelay: `${(seed % 6) * 200}ms` }}
      />
    </div>
  );

  if (!label) return field;
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {field}
    </div>
  );
}
