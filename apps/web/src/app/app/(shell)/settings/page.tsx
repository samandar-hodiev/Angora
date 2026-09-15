import type { Metadata } from "next";

import { SettingsView } from "@/features/profile/components/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsView />;
}
