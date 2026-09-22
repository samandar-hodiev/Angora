"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { OwnerGuard } from "../guard";
import { OwnerShell } from "./shell";

/**
 * What wraps a console route.
 *
 * Everything gets the guard and the shell, with one exception: the sign-in page. It is what
 * you see when you do not have access yet, so putting it behind the guard would make it
 * unreachable, and putting it inside the shell would show a sidebar full of pages you cannot
 * open. One route, named here rather than hidden in a matcher.
 */
export const CONSOLE_LOGIN_PATH = "/owner/login";

export function OwnerArea({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === CONSOLE_LOGIN_PATH) return <>{children}</>;
  return (
    <OwnerGuard>
      <OwnerShell>{children}</OwnerShell>
    </OwnerGuard>
  );
}
