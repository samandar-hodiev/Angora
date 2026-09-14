import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { AccountSettings } from "@/features/auth/components/account-settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description="Manage your account." />
      <AccountSettings />
    </div>
  );
}
