import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-muted-foreground">The page you are looking for doesn&apos;t exist or has moved.</p>
      <Button asChild>
        <Link href="/">Back to Engora</Link>
      </Button>
    </main>
  );
}
