import type { ReactNode } from "react";

import { Brand } from "@/components/common/brand";
import { cn } from "@/lib/utils";

/** The shared atmosphere of the new-learner journey (see `journey-backdrop` in the theme). */
export function JourneyBackdrop() {
  return <div aria-hidden className="journey-backdrop" />;
}

const widths = {
  auth: "max-w-[440px]",
  form: "max-w-[560px]",
  step: "max-w-2xl",
  wide: "max-w-3xl",
} as const;

/**
 * Layout for authentication, account setup, onboarding, level selection and results: one
 * dark background, centred content and no product navigation, so each step has focus.
 */
export function JourneyShell({
  children,
  width = "auth",
  brand = false,
  actions,
  center = true,
}: {
  children: ReactNode;
  width?: keyof typeof widths;
  /** Show the logo in a top bar (auth cards show it inside the card instead). */
  brand?: boolean;
  actions?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <JourneyBackdrop />
      {(brand || actions) && (
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
          {brand ? <Brand href="/" /> : <span />}
          {actions}
        </header>
      )}
      <main
        id="main"
        className={cn("mx-auto flex w-full flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12", widths[width], center && "justify-center")}
      >
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-normal motion-reduce:animate-none">{children}</div>
      </main>
    </div>
  );
}
