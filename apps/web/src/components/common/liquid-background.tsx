import { cn } from "@/lib/utils";

/**
 * Soft ambient fluid field. Reserved for AI, voice and progress moments (AI Coach, AI
 * processing, hero product preview). Static when the user prefers reduced motion.
 */
export function LiquidBackground({ className, intensity = "normal" }: { className?: string; intensity?: "subtle" | "normal" }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div
        className={cn(
          "liquid-field animate-liquid motion-reduce:animate-none",
          intensity === "subtle" ? "opacity-50" : "opacity-90",
        )}
      />
    </div>
  );
}
