"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/common/brand";
import { Button, IconButton } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/overlay";
import { useSession } from "@/features/auth/hooks";

import { marketingNav } from "../content";

/** Floating glass navigation over the hero; stays readable because the surface is tinted. */
export function SiteHeader() {
  const { status } = useSession();
  const signedIn = status === "authenticated";

  return (
    <header className="sticky top-3 z-40 px-3 sm:px-4">
      <div className="glass mx-auto flex h-14 max-w-6xl items-center gap-6 rounded-xl px-3 sm:px-4">
        <Brand />
        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
          {marketingNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-body-sm text-fg-secondary transition-colors duration-micro hover:bg-surface-hover hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Button asChild>
              <Link href="/app/dashboard">Open app</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Start learning</Link>
              </Button>
            </>
          )}
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <IconButton label="Open menu" className="ml-auto md:hidden">
              <Menu />
            </IconButton>
          </SheetTrigger>
          <SheetContent side="right" title="Menu">
            <Brand />
            <nav aria-label="Mobile" className="grid gap-1 pt-2">
              {marketingNav.map((item) => (
                <SheetClose asChild key={item.href}>
                  <Link href={item.href} className="rounded-md px-3 py-2.5 text-body hover:bg-surface-hover">
                    {item.label}
                  </Link>
                </SheetClose>
              ))}
            </nav>
            <div className="mt-auto grid gap-2">
              {signedIn ? (
                <Button asChild size="lg">
                  <Link href="/app/dashboard">Open app</Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg">
                    <Link href="/register">Start learning</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/login">Log in</Link>
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
