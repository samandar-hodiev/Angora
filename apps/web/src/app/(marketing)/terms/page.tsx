import type { Metadata } from "next";

import { LegalDraft } from "@/features/marketing/components/legal-draft";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of using Engora.",
  alternates: { canonical: "/terms" },
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <LegalDraft
      title="Terms of service"
      description="The rules for using Engora."
      sections={[
        { heading: "Your account", text: "Eligibility, account security and acceptable use." },
        { heading: "Subscriptions", text: "Plans, billing, trials, renewals and cancellations." },
        { heading: "AI feedback and estimates", text: "Feedback and band scores are estimates for learning purposes, not official assessments." },
        { heading: "Content and ownership", text: "Your submissions remain yours; Engora content is licensed for personal learning." },
        { heading: "Changes and termination", text: "How these terms may change and how accounts can be closed." },
      ]}
    />
  );
}
