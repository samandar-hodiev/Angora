import { Newspaper } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/common/states";
import { PageHero, Section } from "@/features/marketing/components/sections";

export const metadata: Metadata = {
  title: "Blog",
  description: "Guides and research on learning English effectively with AI feedback.",
  alternates: { canonical: "/blog" },
};

export default function BlogPage() {
  return (
    <>
      <PageHero eyebrow="Blog" title="Ideas for learning English better" description="Practical guides, study methods and product updates." />
      <Section className="max-w-3xl pt-0">
        <EmptyState icon={Newspaper} title="The first articles are on their way" description="We're writing guides on speaking fluency, IELTS writing and building vocabulary that sticks." />
      </Section>
    </>
  );
}
