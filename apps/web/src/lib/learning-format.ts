/** "grammar.tense.present_perfect" → "Present perfect" (last segment, humanised). */
export function formatCategory(category: string): string {
  const last = category.split(".").at(-1) ?? category;
  const text = last.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "grammar.tense.present_perfect" → "Grammar". */
export function formatGroup(category: string): string {
  const first = category.split(".")[0] ?? category;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function severityTone(severity: "low" | "medium" | "high"): "secondary" | "warning" | "destructive" {
  return severity === "high" ? "destructive" : severity === "medium" ? "warning" : "secondary";
}

export function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Relative time like "3h ago" / "2d ago" for activity lists. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
