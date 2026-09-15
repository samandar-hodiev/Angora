import type { Metadata } from "next";

import { LegalDraft } from "@/features/marketing/components/legal-draft";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Engora handles your data.",
  alternates: { canonical: "/privacy" },
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <LegalDraft
      title="Privacy"
      description="How Engora collects, uses and protects your information."
      sections={[
        { heading: "Data we collect", text: "Account details, learning activity, recordings and written answers you submit, and technical data needed to run the service." },
        { heading: "How we use it", text: "To provide feedback, personalise practice, keep your account secure and improve Engora." },
        { heading: "AI processing", text: "Answers are processed by AI providers to generate feedback. Providers are bound by data processing terms." },
        { heading: "Your rights", text: "Access, correction, export and deletion of your data." },
        { heading: "Contact", text: "How to reach us about privacy questions." },
      ]}
    />
  );
}
