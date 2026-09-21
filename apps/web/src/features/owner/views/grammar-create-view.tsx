"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/choice";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { OwnerPageHeader, SectionCard } from "../components/primitives";
import { useCreateGrammarTopic, useGrammarCategories, useGrammarTopics } from "../hooks";
import type { CEFRLevel } from "../types";
import { cefrLevels } from "../types";

/** Slugs are the topic's identity on both sides of the platform, so they are derived, not typed. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function GrammarCreateView() {
  const router = useRouter();
  const categories = useGrammarCategories();
  const existing = useGrammarTopics({ page_size: 200 });
  const create = useCreateGrammarTopic();

  const [title, setTitle] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("tenses");
  const [level, setLevel] = useState<CEFRLevel>("A2");
  const [minutes, setMinutes] = useState(8);
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [prerequisites, setPrerequisites] = useState("");
  const [related, setRelated] = useState("");
  const [ielts, setIelts] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(title);
  const slugTaken = (existing.data?.items ?? []).some((topic) => topic.slug === effectiveSlug);
  const canSubmit = title.trim().length > 1 && effectiveSlug.length > 1 && !slugTaken;

  function submit(thenGenerate: boolean) {
    create.mutate(
      {
        title: title.trim(),
        slug: effectiveSlug,
        category,
        level,
        estimated_minutes: minutes,
        description: description.trim(),
        keywords: keywords.split(",").map((word) => word.trim()).filter(Boolean),
        prerequisites: prerequisites.split("\n").map((line) => line.trim()).filter(Boolean),
        related: related.split("\n").map((line) => line.trim()).filter(Boolean),
        ielts_relevant: ielts,
      },
      {
        onSuccess: (row) => {
          toast({
            title: `"${row.name}" created`,
            description: thenGenerate ? "Opening the editor to generate the lesson." : "Saved as a draft.",
            variant: "success",
          });
          router.push(`/owner/cms/grammar/${row.slug}`);
        },
        onError: () => toast({ title: "The topic could not be created", variant: "error" }),
      },
    );
  }

  return (
    <>
      <OwnerPageHeader
        title="Create grammar topic"
        description="Classify the topic first; the lesson itself can be written or generated afterwards."
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "CMS", href: "/owner/cms" },
          { label: "Grammar", href: "/owner/cms/grammar" },
          { label: "New topic" },
        ]}
      />

      <form
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) submit(false);
        }}
      >
        <div className="grid gap-4">
          <SectionCard title="Topic" description="What learners will see in the library">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="topic-title">Title</Label>
                <Input
                  id="topic-title"
                  value={title}
                  required
                  placeholder="Past Simple"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="topic-slug">Slug</Label>
                <Input
                  id="topic-slug"
                  value={effectiveSlug}
                  placeholder="past-simple"
                  aria-invalid={slugTaken || undefined}
                  aria-describedby="topic-slug-hint"
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(slugify(event.target.value));
                  }}
                />
                <p id="topic-slug-hint" className={slugTaken ? "text-caption text-error" : "text-caption text-fg-muted"}>
                  {slugTaken
                    ? "Another topic already uses this slug."
                    : "Used in the learner URL: /app/grammar/" + (effectiveSlug || "…")}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="topic-description">Short description</Label>
                <Textarea
                  id="topic-description"
                  rows={2}
                  value={description}
                  placeholder="A finished action at a known time in the past."
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="topic-keywords">Keywords</Label>
                <Input
                  id="topic-keywords"
                  value={keywords}
                  placeholder="past simple, irregular verbs, yesterday"
                  onChange={(event) => setKeywords(event.target.value)}
                />
                <p className="text-caption text-fg-muted">Comma separated. Used by grammar search.</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Connections" description="How this topic sits against the rest of the curriculum">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="topic-prerequisites">Prerequisites</Label>
                <Textarea
                  id="topic-prerequisites"
                  rows={4}
                  value={prerequisites}
                  placeholder={"Subject Pronouns\nVerb to be\nRegular / irregular verbs"}
                  onChange={(event) => setPrerequisites(event.target.value)}
                />
                <p className="text-caption text-fg-muted">One per line.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="topic-related">Related topics</Label>
                <Textarea
                  id="topic-related"
                  rows={4}
                  value={related}
                  placeholder={"Present Simple\nPast Continuous\nPresent Perfect"}
                  onChange={(event) => setRelated(event.target.value)}
                />
                <p className="text-caption text-fg-muted">One per line.</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-4">
          <SectionCard title="Classification" description="Where the topic belongs">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="topic-category">Category</Label>
                <NativeSelect id="topic-category" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {(categories.data ?? []).map((entry) => (
                    <option key={entry.slug} value={entry.slug}>
                      {entry.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="topic-level">CEFR level</Label>
                <NativeSelect
                  id="topic-level"
                  value={level}
                  onChange={(event) => setLevel(event.target.value as CEFRLevel)}
                >
                  {cefrLevels.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-caption text-fg-muted">
                  The canonical level. Level-specific retellings are generated per learner level.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="topic-minutes">Estimated time (minutes)</Label>
                <Input
                  id="topic-minutes"
                  type="number"
                  min={1}
                  max={60}
                  value={minutes}
                  onChange={(event) => setMinutes(Number(event.target.value) || 1)}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <Label htmlFor="topic-ielts" className="grid gap-0.5">
                  IELTS relevant
                  <span className="text-caption font-normal text-fg-muted">Shows in IELTS grammar lists</span>
                </Label>
                <Switch id="topic-ielts" checked={ielts} onCheckedChange={setIelts} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Content" description="Write it yourself, or start from a generated draft">
            <div className="grid gap-2">
              <Button type="submit" loading={create.isPending} disabled={!canSubmit}>
                Create as draft
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={create.isPending}
                disabled={!canSubmit}
                onClick={() => submit(true)}
              >
                <Sparkles aria-hidden />
                Create, then generate
              </Button>
              <p className="text-caption text-fg-muted">
                Generation runs in the editor, where each section can be reviewed before it is published.
              </p>
            </div>
          </SectionCard>
        </div>
      </form>
    </>
  );
}
