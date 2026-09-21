"use client";

import { ArrowLeft, Check, CircleDot, Eye, Pencil, Save, Send } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/choice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { LiveDataState } from "../components/live-state";
import {
  ConfirmDialog,
  KeyValue,
  LevelBadge,
  OwnerPageHeader,
  SectionCard,
} from "../components/primitives";
import { useGrammarAdminTopic, useSaveGrammarTopic, useSetGrammarTopicStatus } from "../hooks";
import { formatDate } from "../lib/format";
import { cefrLevels, contentLanguageLabels, contentLanguages } from "../types";
import type { ContentLanguage } from "../types";
import { GrammarLearnerPreview } from "./grammar-preview";

/**
 * One grammar topic, in one language.
 *
 * The explanation is versioned: saving writes a new draft version rather than editing the
 * published one, so what learners are reading never changes underneath them. Publishing the
 * topic publishes the newest version of every language that has been written, and retires
 * the previous ones, in one transaction.
 *
 * Languages are versioned separately, and the editor opens one at a time. English is the
 * one a topic cannot be published without: it is what the AI tutor is given as context, and
 * what a learner reads when their own language has not been translated yet. The other
 * languages ship when they are ready and never hold English back.
 */

const workflow = ["draft", "review", "published"] as const;
const activeTab = "data-[state=active]:text-primary data-[state=active]:ring-1 data-[state=active]:ring-border";

export function GrammarTopicEditorView({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [language, setLanguage] = useState<ContentLanguage>("en");
  const topic = useGrammarAdminTopic(slug, language);
  const save = useSaveGrammarTopic();
  const setStatus = useSetGrammarTopicStatus();

  const [tab, setTab] = useState(params.get("tab") === "preview" ? "preview" : "editor");
  const [publishOpen, setPublishOpen] = useState(false);
  // Keyed by language, so switching tabs reloads that language's text rather than showing
  // the previous one until the request lands.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    level: "B1",
    estimated_minutes: 10,
    ielts_relevant: false,
    keywords: "",
    body: "{}",
  });

  const loadKey = topic.data ? `${topic.data.id}:${topic.data.language}` : null;
  if (topic.data && loadKey !== null && loaded !== loadKey) {
    setLoaded(loadKey);
    setForm({
      name: topic.data.name,
      description: topic.data.description,
      level: topic.data.level ?? "B1",
      estimated_minutes: topic.data.estimated_minutes,
      ielts_relevant: topic.data.ielts_relevant,
      keywords: topic.data.keywords.join(", "),
      body: JSON.stringify(topic.data.body ?? {}, null, 2),
    });
  }

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
        <LiveDataState error={topic.error} onRetry={() => void topic.refetch()} />
      </>
    );
  }

  const detail = topic.data;
  let bodyError: string | null = null;
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = JSON.parse(form.body || "{}") as Record<string, unknown>;
  } catch {
    bodyError = "The explanation must be valid JSON.";
  }

  const currentStep = workflow.indexOf(detail.status as (typeof workflow)[number]);

  return (
    <>
      <OwnerPageHeader
        title={detail.name}
        description={detail.description}
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Content", href: "/owner/cms" },
          { label: "Grammar", href: "/owner/cms/grammar" },
          { label: detail.name },
        ]}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => router.push("/owner/cms/grammar")}>
              <ArrowLeft aria-hidden />
              All topics
            </Button>
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
        <SectionCard title="Publishing" description="Where this topic stands">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {workflow.map((step, index) => {
              const done = index < currentStep;
              const current = index === currentStep;
              return (
                <li key={step} className="flex items-center gap-1">
                  <span
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption font-medium capitalize",
                      current && "bg-primary text-primary-foreground",
                      done && "bg-success/15 text-success",
                      !current && !done && "bg-surface-active text-fg-muted",
                    )}
                  >
                    {done ? <Check className="size-3.5" aria-hidden /> : current ? <CircleDot className="size-3.5" aria-hidden /> : null}
                    {step}
                  </span>
                  {index < workflow.length - 1 && <span aria-hidden className="text-fg-disabled">→</span>}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-caption text-fg-muted">
            {detail.has_content
              ? `${contentLanguageLabels[detail.language]} explanation, version ${detail.version} · ${detail.content_status}`
              : `No ${contentLanguageLabels[detail.language]} explanation yet${detail.language === "en" ? " — a topic cannot be published without the English one." : "."}`}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
            <span>Published in:</span>
            {detail.languages.length === 0 ? (
              <span>nothing yet</span>
            ) : (
              detail.languages.map((code) => (
                <Badge key={code} variant="outline">
                  {contentLanguageLabels[code]}
                </Badge>
              ))
            )}
          </p>
        </SectionCard>

        <SectionCard title="Topic" description="Classification">
          <dl className="grid">
            <KeyValue label="Status">
              <Badge variant="outline" className="capitalize">
                {detail.status}
              </Badge>
            </KeyValue>
            <KeyValue label="Category">{detail.category_name ?? "—"}</KeyValue>
            <KeyValue label="CEFR level">
              {detail.level ? <LevelBadge level={detail.level} /> : "—"}
            </KeyValue>
            <KeyValue label="Practice">
              {detail.question_count > 0 ? `${detail.question_count} questions` : "None yet"}
            </KeyValue>
            <KeyValue label="Updated">{formatDate(detail.updated_at)}</KeyValue>
          </dl>
        </SectionCard>
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
          <div className="grid gap-4">
            <SectionCard title="Details" description="What learners see in the library">
              <div className="grid gap-4 sm:max-w-2xl">
                <div className="grid gap-1.5">
                  <Label htmlFor="topic-name">Name</Label>
                  <Input id="topic-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="topic-description">Description</Label>
                  <Textarea
                    id="topic-description"
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="topic-level">CEFR level</Label>
                    <NativeSelect id="topic-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                      {cefrLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="topic-minutes">Minutes</Label>
                    <Input
                      id="topic-minutes"
                      type="number"
                      min={1}
                      max={120}
                      value={form.estimated_minutes}
                      onChange={(e) => setForm({ ...form, estimated_minutes: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="flex w-full items-center justify-between gap-3 rounded-lg border p-3">
                      <Label htmlFor="topic-ielts" className="text-body-sm">
                        IELTS
                      </Label>
                      <Switch
                        id="topic-ielts"
                        checked={form.ielts_relevant}
                        onCheckedChange={(checked) => setForm({ ...form, ielts_relevant: checked })}
                      />
                    </div>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="topic-keywords">Search keywords</Label>
                  <Input
                    id="topic-keywords"
                    value={form.keywords}
                    onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  />
                  <p className="text-caption text-fg-muted">Comma separated. Grammar search matches these.</p>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Explanation"
              description="Saving writes a new draft version; the published one is untouched until you publish"
              action={
                <>
                  <div className="mr-2 flex rounded-lg border p-0.5" role="group" aria-label="Explanation language">
                    {contentLanguages.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setLanguage(code)}
                        aria-pressed={language === code}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-caption font-medium transition-colors duration-micro",
                          language === code ? "bg-surface-active text-foreground" : "text-fg-muted hover:text-foreground",
                        )}
                      >
                        {contentLanguageLabels[code]}
                      </button>
                    ))}
                  </div>
                <Button
                  size="sm"
                  loading={save.isPending}
                  disabled={bodyError !== null}
                  onClick={() =>
                    save.mutate(
                      {
                        slug,
                        input: {
                          name: form.name.trim(),
                          description: form.description.trim(),
                          level: form.level,
                          estimated_minutes: form.estimated_minutes,
                          ielts_relevant: form.ielts_relevant,
                          keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
                          language,
                          body: parsedBody,
                        },
                      },
                      {
                        onSuccess: () =>
                          toast({
                            title: `Saved as a new ${contentLanguageLabels[language]} draft`,
                            variant: "success",
                          }),
                        onError: (error) =>
                          toast({
                            title: "It could not be saved",
                            description: isApiError(error) ? error.message : undefined,
                            variant: "error",
                          }),
                      },
                    )
                  }
                >
                  <Save aria-hidden />
                  Save
                </Button>
                </>
              }
            >
              <div className="grid gap-1.5">
                <Textarea
                  aria-label="Explanation body"
                  rows={18}
                  className="font-mono text-caption"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  aria-invalid={bodyError !== null}
                />
                <p className={bodyError ? "text-caption text-error" : "text-caption text-fg-muted"}>
                  {bodyError ??
                    "Structured sections: intro, explanation, formulas, usage, examples, signal_words, common_mistakes."}
                </p>
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="preview">
          <GrammarLearnerPreview
            name={detail.name}
            level={detail.level}
            category={detail.category_name}
            minutes={detail.estimated_minutes}
            ielts={detail.ielts_relevant}
            questionCount={detail.question_count}
            body={parsedBody}
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={`Publish "${detail.name}"?`}
        description="The topic goes live with the newest explanation of every language that has been written. Previous versions are retired."
        confirmLabel="Publish"
        loading={setStatus.isPending}
        onConfirm={() => {
          setStatus.mutate(
            { slug, status: "published" },
            {
              onSuccess: () => toast({ title: `"${detail.name}" published`, variant: "success" }),
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
