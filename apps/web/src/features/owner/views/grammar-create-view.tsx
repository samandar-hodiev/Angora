"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/choice";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api";

import { LiveDataState } from "../components/live-state";
import { OwnerPageHeader, SectionCard } from "../components/primitives";
import { useCreateGrammarTopicLive, useGrammarAdminCategories } from "../hooks";
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

/**
 * Creating a grammar topic.
 *
 * Classification first; the explanation is written in the editor afterwards. A topic without
 * an explanation stays a draft — the API will not publish one — which is why this page does
 * not offer a publish button.
 */
export function GrammarCreateView() {
  const router = useRouter();
  const categories = useGrammarAdminCategories();
  const create = useCreateGrammarTopicLive();

  const [title, setTitle] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("A2");
  const [minutes, setMinutes] = useState(10);
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [ielts, setIelts] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(title);
  const effectiveCategory = category || categories.data?.[0]?.slug || "";
  const canSubmit = title.trim().length > 1 && effectiveSlug.length > 1 && effectiveCategory !== "";

  return (
    <>
      <OwnerPageHeader
        title="Create grammar topic"
        description="Classify the topic first; the explanation is written in the editor afterwards."
        breadcrumbs={[
          { label: "Owner", href: "/owner/dashboard" },
          { label: "Content", href: "/owner/cms" },
          { label: "Grammar", href: "/owner/cms/grammar" },
          { label: "New topic" },
        ]}
      />

      {categories.isError ? (
        <LiveDataState error={categories.error} onRetry={() => void categories.refetch()} />
      ) : (
        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            create.mutate(
              {
                slug: effectiveSlug,
                name: title.trim(),
                description: description.trim(),
                category: effectiveCategory,
                level,
                estimated_minutes: minutes,
                ielts_relevant: ielts,
                keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
              },
              {
                onSuccess: (topic) => {
                  toast({ title: `"${topic.name}" created`, description: "Saved as a draft.", variant: "success" });
                  router.push(`/owner/cms/grammar/${topic.slug}`);
                },
                onError: (error) =>
                  toast({
                    title: "The topic could not be created",
                    description: isApiError(error) ? error.message : undefined,
                    variant: "error",
                  }),
              },
            );
          }}
        >
          <SectionCard title="Topic" description="What learners will see in the library">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="topic-title">Title</Label>
                <Input id="topic-title" value={title} required placeholder="Past Simple" onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="topic-slug">Slug</Label>
                <Input
                  id="topic-slug"
                  value={effectiveSlug}
                  placeholder="past-simple"
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
                <p className="text-caption text-fg-muted">Used in the learner URL: /app/grammar/{effectiveSlug || "…"}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="topic-description">Short description</Label>
                <Textarea
                  id="topic-description"
                  rows={2}
                  value={description}
                  placeholder="A finished action at a known time in the past."
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="topic-keywords">Search keywords</Label>
                <Input
                  id="topic-keywords"
                  value={keywords}
                  placeholder="past simple, irregular verbs, yesterday"
                  onChange={(e) => setKeywords(e.target.value)}
                />
                <p className="text-caption text-fg-muted">Comma separated. Grammar search matches these.</p>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-4">
            <SectionCard title="Classification" description="Where the topic belongs">
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="topic-category">Category</Label>
                  <NativeSelect id="topic-category" value={effectiveCategory} onChange={(e) => setCategory(e.target.value)}>
                    {(categories.data ?? []).map((entry) => (
                      <option key={entry.slug} value={entry.slug}>
                        {entry.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="topic-level">CEFR level</Label>
                  <NativeSelect id="topic-level" value={level} onChange={(e) => setLevel(e.target.value)}>
                    {cefrLevels.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="topic-minutes">Estimated time (minutes)</Label>
                  <Input
                    id="topic-minutes"
                    type="number"
                    min={1}
                    max={120}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value) || 1)}
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

            <SectionCard title="Next" description="The explanation comes after">
              <Button type="submit" className="w-full" loading={create.isPending} disabled={!canSubmit}>
                Create as draft
              </Button>
              <p className="mt-2 text-caption text-fg-muted">
                You write the explanation in the editor. A topic cannot be published without one.
              </p>
            </SectionCard>
          </div>
        </form>
      )}
    </>
  );
}
