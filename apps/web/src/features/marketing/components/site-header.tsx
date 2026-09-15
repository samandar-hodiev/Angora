"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type MouseEvent } from "react";

import { Brand } from "@/components/common/brand";
import { Button, IconButton } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/overlay";

import { useI18n } from "../i18n";
import { HeaderAccount, MenuAccount } from "./account-menu";
import { LanguageOptions, LanguageSelector, ThemeOptions, ThemeToggle } from "./preferences";

/** Landing page sections the navigation scrolls to. */
const sections = [
  { id: "skills", key: "features" },
  { id: "ielts", key: "ielts" },
  { id: "how-it-works", key: "howItWorks" },
  { id: "pricing", key: "pricing" },
] as const;

function subscribeScroll(callback: () => void) {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
}

function scrollToSection(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  window.history.replaceState(null, "", `#${id}`);
}

/** Floating liquid-glass navigation. */
export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useSyncExternalStore(subscribeScroll, () => window.scrollY > 12, () => false);

  const go = (event: MouseEvent<HTMLAnchorElement>, id: string, fromMenu = false) => {
    if (pathname !== "/") return; // regular navigation to /#id
    event.preventDefault();
    if (fromMenu) {
      setMenuOpen(false);
      // Wait for the sheet to close and release the scroll lock.
      window.setTimeout(() => scrollToSection(id), 320);
    } else {
      scrollToSection(id);
    }
  };

  return (
    <header className="sticky top-3 z-40 px-3 sm:px-4">
      <div
        data-scrolled={scrolled || undefined}
        className="glass-frosted relative mx-auto flex h-14 max-w-6xl items-center gap-4 overflow-hidden rounded-xl px-3 sm:px-4"
      >
        {/* Faint moving green light behind the frosted surface */}
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
          <span className="absolute -top-10 left-1/4 h-24 w-1/2 animate-liquid-slow rounded-full bg-[radial-gradient(closest-side,var(--glass-tint),transparent)] opacity-70 blur-2xl motion-reduce:animate-none" />
        </span>

        <Brand className="relative" />

        <nav aria-label={t.nav.main} className="relative hidden flex-1 items-center gap-0.5 lg:flex">
          {sections.map((s) => (
            <Link
              key={s.id}
              href={`/#${s.id}`}
              onClick={(e) => go(e, s.id)}
              className="rounded-md px-3 py-1.5 text-body-sm text-fg-secondary outline-none transition-colors duration-micro hover:bg-surface-hover/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {t.nav[s.key]}
            </Link>
          ))}
        </nav>

        <div className="relative ml-auto hidden items-center gap-2 lg:flex">
          <LanguageSelector />
          <ThemeToggle />
          <HeaderAccount
            guest={
              <>
                <Button variant="ghost" size="sm" className="h-9" asChild>
                  <Link href="/login">{t.nav.signIn}</Link>
                </Button>
                <Button variant="liquid" size="sm" className="h-9 px-4" asChild>
                  <Link href="/register">{t.nav.createAccount}</Link>
                </Button>
              </>
            }
          />
        </div>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <IconButton label={t.nav.openMenu} variant="glass" size="icon-sm" className="relative ml-auto size-9 lg:hidden">
              <Menu />
            </IconButton>
          </SheetTrigger>
          <SheetContent side="right" title={t.nav.menu} className="glass-panel gap-6 overflow-y-auto border-l-(--glass-border) bg-transparent">
            <Brand />
            <nav aria-label={t.nav.main} className="grid gap-1">
              {sections.map((s) => (
                <Link
                  key={s.id}
                  href={`/#${s.id}`}
                  onClick={(e) => go(e, s.id, true)}
                  className="rounded-md px-3 py-2.5 text-body outline-none hover:bg-surface-hover/60 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  {t.nav[s.key]}
                </Link>
              ))}
            </nav>
            <div className="grid gap-2">
              <p className="text-label text-fg-muted">{t.nav.language}</p>
              <LanguageOptions />
            </div>
            <div className="grid gap-2">
              <p className="text-label text-fg-muted">{t.nav.theme}</p>
              <ThemeOptions />
            </div>
            <div className="mt-auto">
              <MenuAccount
                onNavigate={() => setMenuOpen(false)}
                guest={
                  <div className="grid gap-2">
                    <Button asChild size="lg" variant="liquid">
                      <Link href="/register">{t.nav.createAccount}</Link>
                    </Button>
                    <Button asChild size="lg" variant="glass">
                      <Link href="/login">{t.nav.signIn}</Link>
                    </Button>
                  </div>
                }
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
