import type { Metadata } from "next";

import { OwnerSettingsView } from "@/features/owner/views/owner-settings-view";

export const metadata: Metadata = { title: "Owner Settings" };

/**
 * The console's own settings. The Learner App's live at /owner/learner-app — one settings
 * implementation each, and they share no table, no endpoint and no cache key.
 */
export default function OwnerSettingsPage() {
  return <OwnerSettingsView />;
}
