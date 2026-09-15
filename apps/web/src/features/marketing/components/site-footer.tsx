"use client";

import Link from "next/link";

import { Brand } from "@/components/common/brand";
import { ApiStatus } from "@/features/system/api-status";

import { useI18n } from "../i18n";
import { StoreBadges } from "./store-badges";

export function SiteFooter() {
  const { t } = useI18n();
  const l = t.footer.links;

  const columns = [
    {
      title: t.footer.product,
      links: [
        ["/features", l.features],
        ["/speaking", l.speaking],
        ["/writing", l.writing],
        ["/reading", l.reading],
        ["/listening", l.listening],
        ["/ielts", l.ielts],
        ["/pricing", l.pricing],
      ],
    },
    {
      title: t.footer.company,
      links: [
        ["/about", l.about],
        ["/blog", l.blog],
        ["/contact", l.contact],
        ["/faq", l.faq],
      ],
    },
    {
      title: t.footer.legal,
      links: [
        ["/privacy", l.privacy],
        ["/terms", l.terms],
      ],
    },
  ];

  return (
    <footer className="relative mt-8 overflow-hidden border-t border-(--glass-border)">
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/2 h-72 w-160 max-w-full -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glass-tint),transparent)] blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="grid content-start gap-4">
          <Brand />
          <p className="max-w-xs text-body-sm text-fg-secondary">{t.footer.tagline}</p>
          <ApiStatus labels={t.footer.status} />
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} className="grid content-start gap-2.5">
            <p className="text-label text-fg-muted">{column.title}</p>
            {column.links.map(([href, label]) => (
              <Link key={href} href={href!} className="w-fit text-body-sm text-fg-secondary transition-colors duration-micro hover:text-primary">
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="relative border-t border-(--glass-border)">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-end md:justify-between">
          <div className="grid max-w-2xl gap-2 text-caption text-fg-muted">
            <span>© {new Date().getFullYear()} Engora</span>
            <p>{t.footer.disclaimer}</p>
          </div>
          <StoreBadges />
        </div>
      </div>
    </footer>
  );
}
