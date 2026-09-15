"use client";

import type { SubscriptionPlan } from "@engora/types";
import { ArrowRight, Check, GraduationCap, MessageSquareQuote, Sparkles, X } from "lucide-react";
import Link from "next/link";

import { SkillIcon } from "@/components/learning/skill-icon";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";

import { ieltsHighlights, learningLoop, skillsMarketing } from "../content";
import { useI18n } from "../i18n";
import { FAQList } from "./faq-accordion";
import { FinalCTA } from "./final-cta";
import { PricingCards } from "./pricing-cards";
import { ProductPreview } from "./product-preview";
import { Section, SectionHeading } from "./sections";

const personalSkills = ["grammar", "speaking", "vocabulary"];
const iconBox = "grid place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary";

export function HomeContent({ plans }: { plans: SubscriptionPlan[] | null }) {
  const { t } = useI18n();

  return (
    <>
      {/* Hero */}
      <section aria-labelledby="hero-title" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 size-144 rounded-full bg-[radial-gradient(closest-side,var(--glass-tint),transparent)] blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:gap-12 lg:pt-24">
          <div className="grid animate-in gap-6 fade-in-0 slide-in-from-bottom-2 duration-emphasis motion-reduce:animate-none">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-caption font-medium text-primary-subtle-foreground">
              <Sparkles className="size-3.5" aria-hidden /> {t.hero.badge}
            </span>
            <h1 id="hero-title" className="text-display text-balance">
              <span className="block">{t.hero.titleLine1}</span>
              <span className="block text-primary">{t.hero.titleLine2}</span>
            </h1>
            <p className="max-w-xl text-body-lg text-pretty text-fg-secondary">{t.hero.subtitle}</p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" variant="liquid" asChild>
                <Link href="/register">
                  {t.hero.primaryCta} <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="glass" asChild>
                <a href="#how-it-works">{t.hero.secondaryCta}</a>
              </Button>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* How Engora works */}
      <Section id="how-it-works" tone="muted" labelledBy="how-title">
        <SectionHeading id="how-title" eyebrow={t.how.eyebrow} title={t.how.title} description={t.how.description} />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {learningLoop.map((step, i) => (
            <li key={step.title} className="glass-card glass-hover grid content-start gap-3 rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <span className={`${iconBox} size-10`}>
                  <step.icon className="size-5" aria-hidden />
                </span>
                <span className="font-mono text-caption text-fg-muted tabular-nums">0{i + 1}</span>
              </div>
              <h3 className="mt-1 text-h4">{t.how.steps[i]?.title}</h3>
              <p className="text-body-sm text-fg-secondary">{t.how.steps[i]?.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Four skills */}
      <Section id="skills" labelledBy="skills-title">
        <SectionHeading id="skills-title" eyebrow={t.skills.eyebrow} title={t.skills.title} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {skillsMarketing.map((skill) => (
            <Link
              key={skill.code}
              href={`/${skill.code}`}
              className="glass-card glass-hover group flex h-full flex-col gap-3 rounded-2xl p-6 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span className={`${iconBox} size-10`}>
                <SkillIcon code={skill.code} className="size-5" />
              </span>
              <h3 className="mt-1 text-h4">{t.skillNames[skill.code]}</h3>
              <p className="text-body-sm text-fg-secondary">{t.skills.descriptions[skill.code]}</p>
              <span className="mt-auto flex items-center gap-1 pt-2 text-label text-primary">
                {t.skills.learnMore}
                <ArrowRight className="size-4 transition-transform duration-micro group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* AI feedback */}
      <Section tone="muted" labelledBy="feedback-title">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <SectionHeading id="feedback-title" eyebrow={t.feedback.eyebrow} title={t.feedback.title} description={t.feedback.description} className="mb-0" />
          <div className="glass-panel relative grid gap-4 overflow-hidden rounded-2xl p-5 sm:p-6" aria-label={t.feedback.example}>
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-label text-primary">
                <Sparkles className="size-4" aria-hidden /> {t.feedback.example}
              </p>
              <span className="rounded-md border border-(--glass-border) px-2 py-0.5 text-caption text-fg-muted">{t.feedback.context}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                [t.feedback.fluency, "7.0"],
                [t.feedback.grammar, "6.0"],
              ].map(([label, score]) => (
                <div key={label} className="glass-card grid gap-1 rounded-xl p-4">
                  <p className="text-label text-fg-muted">{label}</p>
                  <p className="text-h2 tabular-nums">
                    {score} <span className="text-body-sm font-normal text-fg-muted">/ 9</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 rounded-xl border border-(--glass-border) bg-surface/40 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-surface-active px-2 py-0.5 text-caption font-medium">{t.feedback.category}</span>
                <span className="rounded-md bg-error/12 px-2 py-0.5 text-caption font-medium text-error">{t.feedback.severity}</span>
              </div>
              <p className="flex items-start gap-2.5 text-body text-fg-secondary">
                <X className="mt-1 size-4 shrink-0 text-error" aria-label={t.feedback.incorrect} />
                <span className="line-through decoration-error/50">I have went there twice.</span>
              </p>
              <p className="flex items-start gap-2.5 text-body font-medium">
                <Check className="mt-1 size-4 shrink-0 text-success" aria-label={t.feedback.correct} />
                <span>I have gone there twice.</span>
              </p>
              <p className="border-t border-(--glass-border) pt-3 text-body-sm text-fg-muted">{t.feedback.explanation}</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Personalised learning */}
      <Section labelledBy="personal-title">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <ul className="relative order-2 grid gap-3 lg:order-1">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glass-tint),transparent)] blur-3xl" />
            {t.personal.items.map((item, i) => (
              <li key={item.label} className="glass-card glass-hover flex items-center gap-4 rounded-xl p-4 sm:p-5">
                <span className={`${iconBox} size-10 shrink-0`}>
                  <SkillIcon code={personalSkills[i] ?? "grammar"} className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-h4">{item.label}</p>
                  <p className="text-body-sm text-fg-muted">{item.reason}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="order-1 lg:order-2">
            <SectionHeading id="personal-title" eyebrow={t.personal.eyebrow} title={t.personal.title} description={t.personal.description} className="mb-0" />
          </div>
        </div>
      </Section>

      {/* Progress */}
      <Section tone="muted" labelledBy="progress-title">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <SectionHeading id="progress-title" eyebrow={t.progress.eyebrow} title={t.progress.title} description={t.progress.description} className="mb-0" />
          <div className="glass-panel grid gap-5 rounded-2xl p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <p className="text-h4">{t.progress.cardTitle}</p>
              <span className="text-caption text-fg-muted">{t.progress.cardHint}</span>
            </div>
            <Meter label={t.skillNames.speaking} value={72} glow />
            <Meter label={t.skillNames.writing} value={64} glow />
            <Meter label={t.skillNames.reading} value={81} glow />
            <Meter label={t.skillNames.listening} value={67} glow />
            <p className="text-caption text-fg-muted">{t.progress.caption}</p>
          </div>
        </div>
      </Section>

      {/* IELTS */}
      <Section id="ielts" labelledBy="ielts-title">
        <div className="glass-panel relative grid gap-10 overflow-hidden rounded-2xl p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr] lg:p-12">
          <div className="grid content-start gap-4">
            <p className="flex items-center gap-2 text-label text-primary">
              <GraduationCap className="size-4" aria-hidden /> {t.ielts.eyebrow}
            </p>
            <h2 id="ielts-title" className="text-h1 text-balance">
              {t.ielts.title}
            </h2>
            <p className="text-body-lg text-fg-secondary">{t.ielts.description}</p>
            <div className="pt-2">
              <Button variant="liquid" size="lg" asChild>
                <Link href="/ielts">
                  {t.ielts.cta} <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
          <ul className="grid gap-3">
            {ieltsHighlights.map((h, i) => (
              <li key={h.title} className="glass-card glass-hover flex gap-4 rounded-xl p-4 sm:p-5">
                <span className={`${iconBox} size-10 shrink-0`}>
                  <h.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-h4">{t.ielts.highlights[i]?.title}</p>
                  <p className="text-body-sm text-fg-secondary">{t.ielts.highlights[i]?.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Learner stories — honest placeholder; only real stories will appear here. */}
      <Section tone="muted" labelledBy="stories-title" className="py-16 sm:py-20">
        <div className="glass-card mx-auto grid max-w-2xl justify-items-center gap-4 rounded-2xl px-6 py-12 text-center">
          <span className={`${iconBox} size-11`}>
            <MessageSquareQuote className="size-5" aria-hidden />
          </span>
          <h2 id="stories-title" className="text-h2">
            {t.stories.title}
          </h2>
          <p className="max-w-lg text-body text-fg-secondary">{t.stories.text}</p>
          <Button variant="glass" asChild>
            <Link href="/register">{t.stories.cta}</Link>
          </Button>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" labelledBy="pricing-title">
        <SectionHeading id="pricing-title" eyebrow={t.pricing.eyebrow} title={t.pricing.title} align="center" />
        <PricingCards plans={plans} />
      </Section>

      {/* FAQ */}
      <Section id="faq" tone="muted" labelledBy="faq-title" className="max-w-3xl">
        <SectionHeading id="faq-title" eyebrow={t.faq.eyebrow} title={t.faq.title} align="center" />
        <FAQList items={t.faq.items} />
      </Section>

      <div className="pt-24">
        <FinalCTA />
      </div>
    </>
  );
}
