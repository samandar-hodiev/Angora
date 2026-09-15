import type { Metadata } from "next";

import { faqs } from "@/features/marketing/content";
import { FAQList, FinalCTA, PageHero, Section } from "@/features/marketing/components/sections";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about Engora's AI feedback, IELTS scores, plans, mobile apps and your data.",
  alternates: { canonical: "/faq" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
};

export default function FAQPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PageHero eyebrow="FAQ" title="Frequently asked questions" description="Everything you need to know before you start." />
      <Section className="max-w-3xl pt-0">
        <FAQList items={faqs} />
      </Section>
      <FinalCTA />
    </>
  );
}
