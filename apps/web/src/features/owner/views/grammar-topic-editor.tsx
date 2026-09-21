"use client";

import {
  ArrowLeft,
  Check,
  CircleDot,
  Eye,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { grammarSectionMeta } from "../data/grammar";
import {
  ConfirmDialog,
  KeyValue,
  LevelBadge,
  OwnerPageHeader,
  SectionCard,
  StatusBadge,
} from "../components/primitives";
import { useGenerateGrammarContent, useGrammarTopic, useSaveGrammarSection, useSetGrammarStatus } from "../hooks";
import { formatDate, languageLabels, languageNames, statusLabels } from "../lib/format";
import type {
  ContentLanguage,
  ContentStatus,
  GrammarLevelAdaptation,
  GrammarSection,
  GrammarSectionKey,
  GrammarSectionMeta,
  GrammarTopicDetail,
  LanguageStatus,
} from "../types";
import { contentLanguages } from "../types";
import { GrammarLearnerPreview } from "./grammar-preview";

/** The editorial pipeline, in the order a topic moves through it. */
const workflow: ContentStatus[] = ["draft", "ai_generated", "review", "approved", "published", "archived"];

/** Sections written as prose; everything else is a list, one entry per line. */
const proseSections: GrammarSectionKey[] = ["rule", "dont_forget"];

export function GrammarTopicEditorView({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const topic = useGrammarTopic(slug);

  const [tab, setTab] = useState(params.get("tab") === "preview" ? "preview" : "editor");
  const [language, setLanguage] = useState<ContentLanguage>("uz");
  const [publishOpen, setPublishOpen] = useState(false);

  const setStatus = useSetGrammarStatus(slug);

  if (topic.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (topic.isError || !topic.data) {
    return (
      <>
        <OwnerPageHeader
          title="Grammar topic"
          breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Grammar", href: "/owner/cms/grammar" }]}
        />
        <ErrorState
          error={topic.error}
          title="This topic could not be opened"
          description={`No grammar topic with the slug "${slug}".`}
          onRetry={() => void topic.refetch()}
        />
      </>
    );
  }

  const detail = topic.data;
  const nextStatus = nextInWorkflow(detail.status);

  function advance(status: ContentStatus) {
    setStatus.mutate(status, {
      onSuccess: () =>
        toast({
          title: `Moved to ${statusLabels[status]}`,
          description: status === "published" ? "Learners can open this lesson now." : undefined,
          variant: "success",
        }),
      onError: () => toast({ title: "That change did not go through", variant: "error" }),
    });
  }

  return (
    <>
      <OwnerPageHeader
        title={detail.name}
        description={detail.description}
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "CMS", href: "/owner/cms" },
          { label: "Grammar", href: "/owner/cms/grammar" },
          { label: detail.name },
        ]}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => router.push("/owner/cms/grammar")}>
              <ArrowLeft aria-hidden />
              All topics
            </Button>
            <GenerateButton slug={slug} />
            {detail.status !== "published" && (
              <Button size="sm" onClick={() => setPublishOpen(true)}>
                <Send aria-hidden />
                Publish
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <WorkflowBar
          status={detail.status}
          onAdvance={nextStatus ? () => advance(nextStatus) : undefined}
          nextStatus={nextStatus}
          busy={setStatus.isPending}
        />
        <SectionCard title="Topic details" description="Classification and links">
          <dl className="grid">
            <KeyValue label="Status">
              <StatusBadge status={detail.status} />
            </KeyValue>
            <KeyValue label="Category">{detail.category_name}</KeyValue>
            <KeyValue label="CEFR level">
              <LevelBadge level={detail.level} />
            </KeyValue>
            <KeyValue label="Estimated time">{detail.estimated_minutes} min</KeyValue>
            <KeyValue label="Practice">{detail.question_count > 0 ? `${detail.question_count} questions` : "None yet"}</KeyValue>
            <KeyValue label="Prerequisites">
              {detail.prerequisites.map((entry) => entry.name).join(", ") || "None"}
            </KeyValue>
            <KeyValue label="Related topics">{detail.related.map((entry) => entry.name).join(", ") || "None"}</KeyValue>
            <KeyValue label="Last updated">
              {formatDate(detail.updated_at)} · {detail.author}
            </KeyValue>
          </dl>
        </SectionCard>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="editor" className="data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border">
            <Pencil className="size-4" aria-hidden />
            Editor
          </TabsTrigger>
          <TabsTrigger value="levels" className="data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border">
            <Layers className="size-4" aria-hidden />
            Level adaptations
          </TabsTrigger>
          <TabsTrigger value="preview" className="data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border">
            <Eye className="size-4" aria-hidden />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <LanguageTabs detail={detail} language={language} onLanguageChange={setLanguage} />
          <EditorBody detail={detail} language={language} slug={slug} />
        </TabsContent>

        <TabsContent value="levels">
          <LevelAdaptations adaptations={detail.adaptations} topicName={detail.name} />
        </TabsContent>

        <TabsContent value="preview">
          <LanguageTabs detail={detail} language={language} onLanguageChange={setLanguage} />
          <GrammarLearnerPreview topic={detail} language={language} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={`Publish "${detail.name}"?`}
        description="This will make the content available to learners."
        confirmLabel="Publish"
        loading={setStatus.isPending}
        onConfirm={() => {
          advance("published");
          setPublishOpen(false);
        }}
      >
        <ul className="grid gap-1.5 rounded-lg border bg-surface-hover p-3 text-body-sm">
          {contentLanguages.map((code) => (
            <li key={code} className="flex items-center justify-between gap-3">
              <span>{languageNames[code]}</span>
              <LanguageStatusBadge status={detail.content[code].status} />
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}

function nextInWorkflow(status: ContentStatus): ContentStatus | null {
  const index = workflow.indexOf(status);
  if (index < 0 || index >= workflow.length - 2) return null;
  return workflow[index + 1] ?? null;
}

function WorkflowBar({
  status,
  nextStatus,
  onAdvance,
  busy,
}: {
  status: ContentStatus;
  nextStatus: ContentStatus | null;
  onAdvance?: () => void;
  busy: boolean;
}) {
  const currentIndex = workflow.indexOf(status);

  return (
    <SectionCard
      title="Publishing workflow"
      description="Where this lesson stands"
      action={
        onAdvance && nextStatus ? (
          <Button size="sm" variant="outline" loading={busy} onClick={onAdvance}>
            Move to {statusLabels[nextStatus]}
          </Button>
        ) : undefined
      }
    >
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {workflow.slice(0, 5).map((step, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li key={step} className="flex items-center gap-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-medium",
                  current && "bg-primary text-primary-foreground",
                  done && "bg-success/15 text-success",
                  !current && !done && "bg-surface-active text-fg-muted",
                )}
                aria-current={current ? "step" : undefined}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : current ? <CircleDot className="size-3.5" aria-hidden /> : null}
                {statusLabels[step]}
              </span>
              {index < 4 && <span aria-hidden className="text-fg-disabled">→</span>}
            </li>
          );
        })}
        {status === "archived" && <Badge variant="outline">Archived</Badge>}
      </ol>
    </SectionCard>
  );
}

const languageStatusStyles: Record<LanguageStatus, string> = {
  published: "border-transparent bg-success/15 text-success",
  draft: "border-transparent bg-warning/20 text-warning-foreground",
  missing: "border-transparent bg-surface-active text-fg-muted",
};

function LanguageStatusBadge({ status }: { status: LanguageStatus }) {
  return <Badge className={languageStatusStyles[status]}>{status === "missing" ? "Missing" : status === "draft" ? "Draft" : "Published"}</Badge>;
}

/**
 * The lesson's own language, not the site's.
 *
 * Each language is written and published separately, and the Uzbek and Russian versions keep
 * English grammar terminology in English — a learner who reads "Present Perfect" here will
 * meet the same words in an exam.
 */
function LanguageTabs({
  detail,
  language,
  onLanguageChange,
}: {
  detail: GrammarTopicDetail;
  language: ContentLanguage;
  onLanguageChange: (language: ContentLanguage) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-3">
      <div role="group" aria-label="Explanation language" className="inline-flex rounded-lg border bg-background p-0.5">
        {contentLanguages.map((code) => {
          const active = code === language;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={active}
              onClick={() => onLanguageChange(code)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md px-3 text-body-sm font-medium transition-colors duration-micro",
                "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                active ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {languageLabels[code]}
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  detail.content[code].status === "published"
                    ? "bg-success"
                    : detail.content[code].status === "draft"
                      ? "bg-warning"
                      : "bg-fg-disabled",
                )}
              />
            </button>
          );
        })}
      </div>
      <p className="text-caption text-fg-muted">
        Editing the <strong className="font-medium text-foreground">{languageNames[language]}</strong> explanation.
        English grammar terminology stays in English.
      </p>
      <div className="ml-auto">
        <LanguageStatusBadge status={detail.content[language].status} />
      </div>
    </div>
  );
}

function EditorBody({ detail, language, slug }: { detail: GrammarTopicDetail; language: ContentLanguage; slug: string }) {
  const localized = detail.content[language];

  if (localized.status === "missing" || localized.sections.length === 0) {
    return (
      <SectionCard title={`${languageNames[language]} explanation`} description="Nothing written yet">
        <div className="grid justify-items-start gap-3 py-4">
          <p className="text-body-sm text-fg-secondary">
            This topic has no {languageNames[language]} content. Generate a draft, then edit each section.
          </p>
          <GenerateButton slug={slug} languages={[language]} variant="default" />
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="grid gap-4">
      {grammarSectionMeta.map((meta) => {
        const section = localized.sections.find((entry) => entry.key === meta.key);
        if (!section) return null;
        return <SectionEditor key={meta.key} meta={meta} section={section} language={language} slug={slug} />;
      })}
    </div>
  );
}

function SectionEditor({
  meta,
  section,
  language,
  slug,
}: {
  meta: GrammarSectionMeta;
  section: GrammarSection;
  language: ContentLanguage;
  slug: string;
}) {
  const isProse = proseSections.includes(meta.key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(isProse ? section.body : section.items.join("\n"));
  const [regenerating, setRegenerating] = useState(false);
  const save = useSaveGrammarSection(slug);

  function startEditing() {
    setDraft(isProse ? section.body : section.items.join("\n"));
    setEditing(true);
  }

  function commit(value: string) {
    save.mutate(
      {
        language,
        section: meta.key,
        body: isProse ? value : "",
        items: isProse ? [] : value.split("\n").map((line) => line.trim()).filter(Boolean),
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ title: `${meta.label} saved`, variant: "success" });
        },
        onError: () => toast({ title: "Could not save this section", variant: "error" }),
      },
    );
  }

  /**
   * Mock regeneration: it reshapes the section locally so the interaction can be designed and
   * reviewed. No model is called — the real action will POST to the generation endpoint.
   */
  function regenerate() {
    setRegenerating(true);
    setTimeout(() => {
      setRegenerating(false);
      toast({
        title: `${meta.label} regenerated`,
        description: "Mock generation — AI content arrives with the backend.",
      });
    }, 900);
  }

  return (
    <SectionCard
      title={meta.label}
      description={meta.hint}
      action={
        editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X aria-hidden />
              Cancel
            </Button>
            <Button size="sm" loading={save.isPending} onClick={() => commit(draft)}>
              <Save aria-hidden />
              Save
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" loading={regenerating} onClick={regenerate}>
              <RefreshCw aria-hidden />
              Regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={startEditing}>
              <Pencil aria-hidden />
              Edit
            </Button>
          </>
        )
      }
    >
      {editing ? (
        <div className="grid gap-2">
          <label className="grid gap-1.5">
            <span className="text-caption text-fg-muted">
              {isProse ? "Plain text. Leave a blank line between paragraphs." : "One entry per line."}
            </span>
            <Textarea
              value={draft}
              rows={isProse ? 6 : Math.max(4, draft.split("\n").length + 1)}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={`${meta.label} in ${languageNames[language]}`}
            />
          </label>
        </div>
      ) : isProse ? (
        section.body ? (
          <div className="grid gap-2">
            {section.body.split("\n\n").map((paragraph, index) => (
              <p key={index} className="text-body-sm">
                {paragraph}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-body-sm text-fg-muted">Nothing written yet.</p>
        )
      ) : section.items.length > 0 ? (
        <ul className="grid gap-1.5">
          {section.items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex items-start gap-2 text-body-sm">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-fg-muted">Nothing written yet.</p>
      )}
    </SectionCard>
  );
}

function LevelAdaptations({ adaptations, topicName }: { adaptations: GrammarLevelAdaptation[]; topicName: string }) {
  const [generating, setGenerating] = useState<string | null>(null);

  return (
    <SectionCard
      title="Level adaptations"
      description={`One canonical rule, retold for each CEFR level. You never write six versions of ${topicName} by hand.`}
    >
      <ul className="grid gap-2">
        {adaptations.map((adaptation) => (
          <li
            key={adaptation.level}
            className="flex flex-wrap items-start gap-3 rounded-lg border bg-surface p-3 sm:flex-nowrap"
          >
            <LevelBadge level={adaptation.level} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="text-body-sm">{adaptation.summary}</p>
              <p className="text-caption text-fg-muted">
                {adaptation.status === "generated" && adaptation.generated_at
                  ? `Generated ${formatDate(adaptation.generated_at)}`
                  : "Not generated yet"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={generating === adaptation.level}
              onClick={() => {
                setGenerating(adaptation.level);
                setTimeout(() => {
                  setGenerating(null);
                  toast({
                    title: `${adaptation.level} adaptation queued`,
                    description: "Mock generation — level adaptations arrive with the AI backend.",
                  });
                }, 900);
              }}
            >
              <Sparkles aria-hidden />
              {adaptation.status === "generated" ? "Regenerate" : "Generate"}
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** "Generate with AI" plus the dialog that reports what the mock run is writing. */
export function GenerateButton({
  slug,
  languages,
  variant = "outline",
}: {
  slug: string;
  languages?: ContentLanguage[];
  variant?: "outline" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const generate = useGenerateGrammarContent(slug);

  function start() {
    setDone([]);
    setOpen(true);
    generate.mutate(
      {
        languages,
        onStep: (step) => setDone((entries) => [...entries, step.label]),
      },
      {
        onSuccess: () => {
          toast({
            title: "Draft generated",
            description: "Review each section before publishing.",
            variant: "success",
          });
        },
        onError: () => {
          setOpen(false);
          toast({ title: "Generation failed", variant: "error" });
        },
      },
    );
  }

  const steps = [
    "Core rule",
    "Formula",
    "Examples",
    "Common mistakes",
    "Exceptions",
    "Tips",
    "Uzbek explanation",
    "English explanation",
    "Russian explanation",
    "Practice questions",
  ];

  return (
    <>
      <Button size="sm" variant={variant} onClick={start} loading={generate.isPending}>
        <Sparkles aria-hidden />
        Generate with AI
      </Button>

      <Dialog open={open} onOpenChange={(next) => !generate.isPending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{generate.isPending ? "Generating grammar content…" : "Draft ready"}</DialogTitle>
            <DialogDescription>
              {generate.isPending
                ? "Writing the lesson section by section."
                : "Every section was written as a draft. Nothing is published until you say so."}
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1.5" aria-live="polite">
            {steps.map((step) => {
              const complete = done.includes(step);
              const active = generate.isPending && !complete && done.length === steps.indexOf(step);
              return (
                <li
                  key={step}
                  className={cn(
                    "flex items-center gap-2 text-body-sm",
                    complete ? "text-foreground" : active ? "text-foreground" : "text-fg-muted",
                  )}
                >
                  {complete ? (
                    <Check className="size-4 text-success" aria-hidden />
                  ) : active ? (
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  ) : (
                    <span aria-hidden className="size-4" />
                  )}
                  {step}
                </li>
              );
            })}
          </ul>
          <p className="text-caption text-fg-muted">
            Mock generation: no model is called and nothing leaves this browser.
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={generate.isPending} onClick={() => setOpen(false)}>
              {generate.isPending ? "Generating…" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { LanguageTabs };
