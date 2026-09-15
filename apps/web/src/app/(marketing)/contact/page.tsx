import { LifeBuoy, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHero, Section } from "@/features/marketing/components/sections";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the Engora team.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="We'd love to hear from you" description="Questions, feedback or partnership ideas — reach out any time." />
      <Section className="max-w-3xl pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-3 rounded-xl border bg-surface p-6">
            <Mail className="size-5 text-primary" aria-hidden />
            <h2 className="text-h4">Email</h2>
            {supportEmail ? (
              <a href={`mailto:${supportEmail}`} className="text-body text-primary underline-offset-4 hover:underline">
                {supportEmail}
              </a>
            ) : (
              <p className="text-body-sm text-fg-secondary">Our support address will be published here at launch.</p>
            )}
          </div>
          <div className="grid content-start gap-3 rounded-xl border bg-surface p-6">
            <LifeBuoy className="size-5 text-primary" aria-hidden />
            <h2 className="text-h4">Help</h2>
            <p className="text-body-sm text-fg-secondary">Most answers are already in our FAQ.</p>
            <Button variant="outline" asChild className="justify-self-start">
              <Link href="/faq">Read the FAQ</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
