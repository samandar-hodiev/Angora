import { cn } from "@/lib/utils";

/**
 * Small language flags, drawn rather than emoji: flag emoji do not render on Windows, where
 * they fall back to two letters. Each is a 3:2 rectangle with a hairline edge so a white
 * stripe still reads on a light surface.
 */

type FlagProps = { className?: string; title?: string };

function Frame({ className, title, children }: FlagProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 30 20"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("inline-block h-3 w-[1.125rem] shrink-0 overflow-hidden rounded-[2px] ring-1 ring-black/10", className)}
    >
      {children}
    </svg>
  );
}

export function FlagGB(props: FlagProps) {
  return (
    <Frame {...props}>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0V20M0 10H30" stroke="#C8102E" strokeWidth="3.4" />
    </Frame>
  );
}

export function FlagUZ(props: FlagProps) {
  return (
    <Frame {...props}>
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.4" fill="#0099B5" />
      <rect y="13.6" width="30" height="6.4" fill="#1EB53A" />
      <rect y="6.4" width="30" height="0.6" fill="#CE1126" />
      <rect y="13" width="30" height="0.6" fill="#CE1126" />
      <circle cx="5" cy="3.2" r="2" fill="#fff" />
      <circle cx="5.8" cy="3.2" r="1.7" fill="#0099B5" />
    </Frame>
  );
}

export function FlagRU(props: FlagProps) {
  return (
    <Frame {...props}>
      <rect width="30" height="20" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039A6" />
      <rect y="13.33" width="30" height="6.67" fill="#D52B1E" />
    </Frame>
  );
}
