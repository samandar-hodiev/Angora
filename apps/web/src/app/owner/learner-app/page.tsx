import type { Metadata } from "next";

import { LearnerAppSettingsView } from "@/features/owner/views/learner-app-view";

export const metadata: Metadata = { title: "Learner App" };

/**
 * The Learner App's configuration — defaults, features, wallpapers, maintenance.
 *
 * It used to live at /owner/settings, which made it look like this console's own settings.
 * It is not: everything on this page changes what learners get. The console's own settings
 * are at /owner/settings.
 */
export default function OwnerLearnerAppPage() {
  return <LearnerAppSettingsView />;
}
