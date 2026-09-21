import type { Metadata } from "next";

import { OwnerSettingsView } from "@/features/owner/views/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function OwnerSettingsPage() {
  return <OwnerSettingsView />;
}
