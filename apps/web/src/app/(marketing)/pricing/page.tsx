import type { Metadata } from "next";

import { faqs } from "@/features/marketing/content";
import { FAQList, PageHero, PricingPlans, Section } from "@/features/marketing/components/sections";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Start free. Upgrade to Pro or IELTS Pro for more AI feedback, the AI Coach and IELTS mock exams.",
  alternates: { canonical: "/pricing" },
};

export const revalidate = 600;

export default function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Pricing" title="Simple plans that grow with you" description="Start free. Upgrade when you want more AI feedback and IELTS preparation." />
      <Section className="pt-0">
        <PricingPlans />
      </Section>
      <Section tone="muted" className="max-w-3xl" labelledBy="pricing-faq">
        <h2 id="pricing-faq" className="mb-8 text-center text-h2">
          Common questions
        </h2>
        <FAQList items={faqs.filter((f) => /free|IELTS|phone/i.test(f.question))} />
      </Section>
    </>
  );
}
