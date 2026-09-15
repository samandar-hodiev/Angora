import type { SubscriptionPlan } from "@engora/types";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LiquidBackground } from "@/components/common/liquid-background";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeEntitlement, formatPlanPrice } from "@/features/subscription/lib/entitlements";
import { cn } from "@/lib/utils";

export function Section({
  id,
  children,
  className,
  tone = "default",
  labelledBy,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: "default" | "muted";
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn(tone === "muted" && "border-y bg-surface/50", "scroll-mt-24")}>
      <div className={cn("mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24", className)}>{children}</div>
    </section>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("mb-12 grid max-w-2xl gap-3", align === "center" && "mx-auto text-center")}>
      {eyebrow && <p className="text-label text-primary">{eyebrow}</p>}
      <h2 id={id} className="text-h1 text-balance">
        {title}
      </h2>
      {description && <p className="text-body-lg text-pretty text-fg-secondary">{description}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 pt-20 pb-12 text-center sm:px-6 sm:pt-28">
      {eyebrow && <p className="text-label text-primary">{eyebrow}</p>}
      <h1 className="text-display text-balance">{title}</h1>
      <p className="text-body-lg text-pretty text-fg-secondary">{description}</p>
      {actions && <div className="flex flex-wrap justify-center gap-3 pt-2">{actions}</div>}
    </div>
  );
}

/** Premium closing call to action: one of the few glass + liquid surfaces on the site. */
export function FinalCTA({ title = "Start improving your English today", description }: { title?: string; description?: string }) {
  return (
    <section aria-labelledby="cta-title" className="px-4 pb-24 sm:px-6">
      <div className="relative isolate mx-auto max-w-5xl overflow-hidden rounded-2xl border">
        <LiquidBackground />
        <div className="glass relative grid justify-items-center gap-5 rounded-2xl border-0 px-6 py-16 text-center">
          <h2 id="cta-title" className="max-w-2xl text-h1 text-balance">
            {title}
          </h2>
          <p className="max-w-xl text-body-lg text-fg-secondary">
            {description ?? "Create a free account, answer four quick questions and get your first personalised plan."}
          </p>
          <Button size="lg" asChild>
            <Link href="/register">
              Start learning <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function FAQList({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <div className="divide-y rounded-xl border bg-surface">
      {items.map((item) => (
        <details key={item.question} className="group px-5 py-1 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-4 text-h4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
            {item.question}
            <ChevronDown className="size-4 shrink-0 text-fg-muted transition-transform duration-normal group-open:rotate-180" aria-hidden />
          </summary>
          <p className="pb-5 text-body text-fg-secondary">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

// ---- Pricing (server-rendered from the API) -------------------------------------------------

async function fetchPublicPlans(): Promise<SubscriptionPlan[] | null> {
  const base = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/v1/subscriptions/plans`, { next: { revalidate: 600 } });
    if (!res.ok) return null;
    const envelope = (await res.json()) as { success: boolean; data?: SubscriptionPlan[] };
    return envelope.success && envelope.data ? envelope.data : null;
  } catch {
    return null;
  }
}

/** Plans, prices and entitlements are fetched from the API — never hardcoded here. */
export async function PricingPlans() {
  const plans = await fetchPublicPlans();

  if (!plans || plans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-h4">Plans are temporarily unavailable</p>
        <p className="mt-1 text-body-sm text-fg-secondary">You can start free today and see all plans inside the app.</p>
        <Button className="mt-5" asChild>
          <Link href="/register">Start free</Link>
        </Button>
      </div>
    );
  }

  const highlight = plans.find((p) => !p.is_default && p.billing_interval !== "none")?.code;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {plans.map((plan) => {
        const featured = plan.code === highlight;
        return (
          <article
            key={plan.id}
            className={cn(
              "flex flex-col gap-6 rounded-xl border bg-surface p-6",
              featured && "border-primary shadow-md ring-1 ring-primary",
            )}
          >
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-h3">{plan.name}</h3>
                {featured && <Badge>Most popular</Badge>}
              </div>
              <p className="text-body-sm text-fg-secondary">{plan.description}</p>
            </div>
            <div>
              <p className="text-h1 tabular-nums">{formatPlanPrice(plan, "en-US")}</p>
              {plan.trial_days > 0 && <p className="text-caption text-fg-muted">{plan.trial_days}-day free trial</p>}
            </div>
            <ul className="grid gap-2.5 text-body-sm">
              {plan.entitlements.map((e) => (
                <li key={e.key} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <span>{describeEntitlement(e)}</span>
                </li>
              ))}
            </ul>
            <Button className="mt-auto" variant={featured ? "default" : "outline"} asChild>
              <Link href="/register">{plan.is_default ? "Start free" : `Choose ${plan.name}`}</Link>
            </Button>
          </article>
        );
      })}
    </div>
  );
}
