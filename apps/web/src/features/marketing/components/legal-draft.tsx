import { TriangleAlert } from "lucide-react";

import { PageHero, Section } from "./sections";

/**
 * Structure for a legal page whose final text has not been written yet. It is clearly
 * marked as a draft so it is never mistaken for a binding policy.
 */
export function LegalDraft({ title, description, sections }: { title: string; description: string; sections: { heading: string; text: string }[] }) {
  return (
    <>
      <PageHero title={title} description={description} />
      <Section className="max-w-3xl pt-0">
        <div role="note" className="mb-10 flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-body-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>This page is a draft outline. The final, legally reviewed version will replace it before public launch.</p>
        </div>
        <div className="grid gap-8">
          {sections.map((s) => (
            <section key={s.heading} className="grid gap-2">
              <h2 className="text-h3">{s.heading}</h2>
              <p className="max-w-prose text-body text-fg-secondary">{s.text}</p>
            </section>
          ))}
        </div>
      </Section>
    </>
  );
}
