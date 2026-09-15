import Link from "next/link";

import { Brand } from "@/components/common/brand";
import { ApiStatus } from "@/features/system/api-status";

import { ieltsDisclaimer } from "../content";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/speaking", label: "Speaking" },
      { href: "/writing", label: "Writing" },
      { href: "/reading", label: "Reading" },
      { href: "/listening", label: "Listening" },
      { href: "/ielts", label: "IELTS" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/blog", label: "Blog" },
      { href: "/contact", label: "Contact" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-surface/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="grid content-start gap-3">
          <Brand />
          <p className="max-w-xs text-body-sm text-fg-secondary">Your AI English Coach. Practice, feedback and progress in one place.</p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} className="grid content-start gap-2.5">
            <p className="text-label text-fg-muted">{column.title}</p>
            {column.links.map((link) => (
              <Link key={link.href} href={link.href} className="text-body-sm text-fg-secondary hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-caption text-fg-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} Engora</span>
          <p className="max-w-2xl md:text-center">{ieltsDisclaimer}</p>
          <ApiStatus />
        </div>
      </div>
    </footer>
  );
}
