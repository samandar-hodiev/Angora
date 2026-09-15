import { Button } from "@/components/ui/button";

/**
 * Social sign-in entry points. Buttons stay disabled until the API supports OAuth, so the
 * layout is final without pretending the feature works.
 */
export function SocialAuth() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {["Google", "Apple"].map((provider) => (
          <Button key={provider} variant="outline" disabled aria-describedby="social-soon">
            Continue with {provider}
          </Button>
        ))}
      </div>
      <p id="social-soon" className="text-center text-caption text-fg-muted">
        Google and Apple sign-in are coming soon.
      </p>
      <div className="flex items-center gap-3 text-caption text-fg-muted" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
