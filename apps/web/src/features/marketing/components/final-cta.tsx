"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { LiquidBackground } from "@/components/common/liquid-background";
import { Button } from "@/components/ui/button";

import { useI18n } from "../i18n";

/** Closing call to action: dark glass with slowly moving green ambient light. */
export function FinalCTA({ title, description }: { title?: string; description?: string }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="cta-title" className="px-4 pb-24 sm:px-6">
      <div className="glass-panel relative isolate mx-auto max-w-5xl overflow-hidden rounded-2xl">
        <LiquidBackground intensity="subtle" className="opacity-70" />
        <div className="relative grid justify-items-center gap-5 px-6 py-16 text-center sm:py-20">
          <h2 id="cta-title" className="max-w-2xl text-h1 text-balance">
            {title ?? t.cta.title}
          </h2>
          <p className="max-w-xl text-body-lg text-fg-secondary">{description ?? t.cta.description}</p>
          <Button size="lg" variant="liquid" asChild>
            <Link href="/register">
              {t.cta.button} <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
