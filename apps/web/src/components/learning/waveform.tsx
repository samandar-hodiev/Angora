import { cn } from "@/lib/utils";

/**
 * Audio waveform from loudness levels (0–1). Bars ease between values so the motion feels
 * fluid rather than jittery. When idle it shows a quiet resting shape.
 */
export function Waveform({
  levels,
  active,
  className,
  label = "Audio level",
}: {
  levels: number[];
  active: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <div role="img" aria-label={label} className={cn("flex h-20 items-center justify-center gap-[3px]", className)}>
      {levels.map((level, i) => {
        // Resting shape: a gentle arch so the component never looks broken.
        const rest = 0.08 + 0.06 * Math.sin((i / Math.max(levels.length - 1, 1)) * Math.PI);
        const value = active ? Math.max(level, 0.06) : rest;
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-full transition-[height,background-color] duration-normal ease-standard motion-reduce:transition-none",
              active ? "bg-primary" : "bg-fg-disabled",
            )}
            style={{ height: `${Math.round(value * 100)}%`, opacity: active ? 0.45 + level * 0.55 : 1 }}
          />
        );
      })}
    </div>
  );
}
