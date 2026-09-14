import { Loader2 } from "lucide-react";

export function FullPageLoader({ label }: { label: string }) {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}
