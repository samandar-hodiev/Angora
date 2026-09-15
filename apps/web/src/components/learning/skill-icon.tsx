import {
  AudioLines,
  BookOpenText,
  GraduationCap,
  Headphones,
  Mic,
  PenLine,
  Shapes,
  Sparkles,
  SpellCheck,
  type LucideIcon,
} from "lucide-react";

/** Presentation only. Unknown skill codes from the API fall back to a generic icon. */
const icons: Record<string, LucideIcon> = {
  speaking: Mic,
  writing: PenLine,
  reading: BookOpenText,
  listening: Headphones,
  grammar: Shapes,
  vocabulary: SpellCheck,
  pronunciation: AudioLines,
  ielts: GraduationCap,
};

export function SkillIcon({ code, className }: { code: string; className?: string }) {
  const Icon = icons[code] ?? Sparkles;
  return <Icon className={className} aria-hidden />;
}
