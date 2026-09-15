"use client";

import { ChevronDown } from "lucide-react";
import { Accordion } from "radix-ui";

/** Accessible accordion (Radix): keyboard support, aria-expanded, smooth height animation. */
export function FAQList({ items }: { items: { question: string; answer: string }[] }) {
  return (
    <Accordion.Root type="single" collapsible className="glass-card divide-y divide-(--glass-border) overflow-hidden rounded-2xl">
      {items.map((item, i) => (
        <Accordion.Item key={item.question} value={`item-${i}`} className="group transition-colors duration-normal data-[state=open]:bg-primary/[0.04]">
          <Accordion.Header asChild>
            <h3>
              <Accordion.Trigger className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left text-h4 outline-none transition-colors duration-micro hover:text-primary-subtle-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset sm:px-6">
                {item.question}
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-(--glass-border) transition-[transform,border-color,color] duration-normal group-data-[state=open]:rotate-180 group-data-[state=open]:border-primary/40 group-data-[state=open]:text-primary">
                  <ChevronDown className="size-4" aria-hidden />
                </span>
              </Accordion.Trigger>
            </h3>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down motion-reduce:animate-none">
            <p className="max-w-3xl px-5 pb-5 text-body text-fg-secondary sm:px-6">{item.answer}</p>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
