import { ArrowRight, GraduationCap, MessageSquareQuote, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MistakeCard, ScoreCard } from "@/components/learning/cards";
import { SkillIcon } from "@/components/learning/skill-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/data-display";
import { faqs, ieltsHighlights, learningLoop, skillsMarketing } from "@/features/marketing/content";
import { ProductPreview } from "@/features/marketing/components/product-preview";
import { FAQList, FinalCTA, PricingPlans, Section, SectionHeading } from "@/features/marketing/components/sections";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "Engora — Your AI English Coach" },
  alternates: { canonical: "/" },
};

export const revalidate = 600;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Engora",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  description: "AI English coach for speaking, writing, reading and listening practice with personalised feedback.",
  url: siteUrl,
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <section aria-labelledby="hero-title" className="overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:pt-24">
          <div className="grid gap-6">
            <Badge variant="secondary" className="gap-1.5">
              <Sparkles aria-hidden /> Your AI English Coach
            </Badge>
            <h1 id="hero-title" className="text-display text-balance">
              Your English.
              <br />
              <span className="text-primary">Your AI Coach.</span>
            </h1>
            <p className="max-w-xl text-body-lg text-pretty text-fg-secondary">
              Practice speaking, writing, reading and listening with AI feedback that adapts to what you need to improve.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/register">
                  Start learning <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* How it works */}
      <Section id="how-it-works" tone="muted" labelledBy="how-title">
        <SectionHeading
          id="how-title"
          eyebrow="How Engora works"
          title="A learning loop that gets smarter every session"
          description="Each answer you give teaches Engora what to practise with you next."
        />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {learningLoop.map((step, i) => (
            <li key={step.title} className="grid gap-3 rounded-xl border bg-surface p-6">
              <div className="flex items-center justify-between">
                <step.icon className="size-5 text-primary" aria-hidden />
                <span className="text-caption text-fg-muted tabular-nums">0{i + 1}</span>
              </div>
              <h3 className="text-h4">{step.title}</h3>
              <p className="text-body-sm text-fg-secondary">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Four skills */}
      <Section labelledBy="skills-title">
        <SectionHeading id="skills-title" eyebrow="Four skills" title="Everything you need to use English with confidence" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {skillsMarketing.map((skill) => (
            <Link
              key={skill.code}
              href={`/${skill.code}`}
              className="group grid content-start gap-3 rounded-xl border bg-surface p-6 outline-none transition-colors duration-micro hover:border-primary/40 hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span className="grid size-10 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                <SkillIcon code={skill.code} className="size-5" />
              </span>
              <h3 className="text-h4">{skill.title}</h3>
              <p className="text-body-sm text-fg-secondary">{skill.description}</p>
              <span className="flex items-center gap-1 text-label text-primary">
                Learn more <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* AI feedback */}
      <Section tone="muted" labelledBy="feedback-title">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <SectionHeading
            id="feedback-title"
            eyebrow="AI feedback"
            title="Feedback you can act on"
            description="See what you did well, what to fix and why — with corrected sentences, not vague advice."
          />
          <div className="grid gap-4" aria-label="Example feedback">
            <div className="grid grid-cols-2 gap-4">
              <ScoreCard label="Fluency & coherence" score={7} scale="ielts_band" />
              <ScoreCard label="Grammar" score={6} scale="ielts_band" />
            </div>
            <MistakeCard
              category="grammar.tense.present_perfect"
              original="I have went there twice."
              correction="I have gone there twice."
              explanation="After have/has, use the past participle: gone."
              severity="high"
            />
            <p className="text-caption text-fg-muted">Example feedback</p>
          </div>
        </div>
      </Section>

      {/* Personalized learning */}
      <Section labelledBy="personal-title">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="order-2 grid gap-3 lg:order-1">
            {[
              { label: "Present perfect", reason: "Repeated in 3 of your last 5 answers", skill: "grammar" },
              { label: "Talk about a memorable trip", reason: "Practise past tenses in context", skill: "speaking" },
              { label: "Collocations with make / do", reason: "Common in your writing", skill: "vocabulary" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-4 rounded-xl border bg-surface p-4">
                <span className="grid size-9 place-items-center rounded-lg bg-primary-subtle text-primary-subtle-foreground">
                  <SkillIcon code={item.skill} className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-h4">{item.label}</p>
                  <p className="text-body-sm text-fg-muted">{item.reason}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="order-1 lg:order-2">
            <SectionHeading
              id="personal-title"
              eyebrow="Personalised learning"
              title="Practice built from your own mistakes"
              description="Engora groups the errors you repeat and turns them into short, targeted exercises — so every session counts."
            />
          </div>
        </div>
      </Section>

      {/* Progress */}
      <Section tone="muted" labelledBy="progress-title">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <SectionHeading
            id="progress-title"
            eyebrow="Progress"
            title="See every skill improve"
            description="Clear skill scores, streaks and history — synced across your devices."
          />
          <div className="grid gap-4 rounded-xl border bg-surface p-6">
            <Meter label="Speaking" value={72} />
            <Meter label="Writing" value={64} />
            <Meter label="Reading" value={81} />
            <Meter label="Listening" value={67} />
            <p className="text-caption text-fg-muted">Illustrative progress</p>
          </div>
        </div>
      </Section>

      {/* IELTS */}
      <Section labelledBy="ielts-title">
        <div className="grid gap-10 rounded-2xl border bg-surface p-8 sm:p-12 lg:grid-cols-[1.2fr_1fr]">
          <div className="grid content-start gap-4">
            <p className="flex items-center gap-2 text-label text-primary">
              <GraduationCap className="size-4" aria-hidden /> IELTS mode
            </p>
            <h2 id="ielts-title" className="text-h1">
              Preparing for IELTS? There&apos;s a mode for that.
            </h2>
            <p className="text-body-lg text-fg-secondary">
              Exam-style tasks, estimated band scores and full mock exams — on the same engine you use every day.
            </p>
            <div>
              <Button variant="outline" asChild>
                <Link href="/ielts">
                  Explore IELTS preparation <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
          <ul className="grid gap-3">
            {ieltsHighlights.map((h) => (
              <li key={h.title} className="flex gap-3 rounded-lg border p-4">
                <h.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-h4">{h.title}</p>
                  <p className="text-body-sm text-fg-secondary">{h.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Testimonials: only real learner stories will be published here. */}
      <Section tone="muted" labelledBy="stories-title">
        <div className="grid justify-items-center gap-4 text-center">
          <MessageSquareQuote className="size-6 text-primary" aria-hidden />
          <h2 id="stories-title" className="text-h2">
            Learner stories
          </h2>
          <p className="max-w-xl text-body text-fg-secondary">
            Engora is new. We&apos;ll share stories from real learners here — never invented reviews. Be one of the first.
          </p>
          <Button variant="outline" asChild>
            <Link href="/register">Join the first learners</Link>
          </Button>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" labelledBy="pricing-title">
        <SectionHeading id="pricing-title" eyebrow="Pricing" title="Start free. Upgrade when you're ready." align="center" />
        <PricingPlans />
      </Section>

      {/* FAQ */}
      <Section tone="muted" labelledBy="faq-title" className="max-w-3xl">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered" align="center" />
        <FAQList items={faqs} />
      </Section>

      <div className="pt-24">
        <FinalCTA />
      </div>
    </>
  );
}
