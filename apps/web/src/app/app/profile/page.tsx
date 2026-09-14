import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { ProfileCard } from "@/features/profile/components/profile-form";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Profile" description="Your learning profile and goals." />
      <ProfileCard />
    </div>
  );
}
