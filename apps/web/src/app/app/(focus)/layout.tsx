import type { ReactNode } from "react";

/** Focus mode (exams): no navigation, no decorative effects. */
export default function FocusLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
