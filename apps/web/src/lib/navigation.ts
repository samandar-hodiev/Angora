const DEFAULT_REDIRECT = "/app/dashboard";

/**
 * Sanitizes a post-login redirect target taken from the URL. Only same-origin app paths
 * are allowed, which prevents open redirects (e.g. ?next=//evil.example).
 */
export function safeRedirect(target: string | null | undefined, fallback = DEFAULT_REDIRECT): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) {
    return fallback;
  }
  if (target.startsWith("/api/")) return fallback;
  return target;
}
