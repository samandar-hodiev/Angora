import type { Metadata } from "next";

import { OwnerNotificationsView } from "@/features/owner/views/notifications-view";

export const metadata: Metadata = { title: "Notifications" };

export default function OwnerNotificationsPage() {
  return <OwnerNotificationsView />;
}
