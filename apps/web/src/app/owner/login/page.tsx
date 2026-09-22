import type { Metadata } from "next";

import { ConsoleLogin } from "@/features/owner/components/console-login";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default function OwnerLoginPage() {
  return <ConsoleLogin />;
}
