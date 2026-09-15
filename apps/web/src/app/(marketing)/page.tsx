import type { Metadata } from "next";

import { HomeContent } from "@/features/marketing/components/home-content";
import { fetchPublicPlans } from "@/features/marketing/components/pricing-plans";
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

export default async function HomePage() {
  const plans = await fetchPublicPlans();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeContent plans={plans} />
    </>
  );
}
