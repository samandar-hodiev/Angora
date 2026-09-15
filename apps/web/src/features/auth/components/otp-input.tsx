"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * Accessible one-time-code input: one box per digit, paste and SMS/email autofill support
 * (autocomplete="one-time-code"), arrow-key and backspace navigation.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
  describedBy,
  label = "Verification code",
}: {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
  label?: string;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const focus = (index: number) => inputs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length && clean !== value) onComplete?.(clean);
    return clean;
  };

  const handleChange = (index: number, raw: string) => {
    let chars = raw.replace(/\D/g, "");
    if (digits[index] && chars.length === 2 && chars.startsWith(digits[index])) chars = chars.slice(1);
    if (!chars) {
      commit(value.slice(0, index) + value.slice(index + 1));
      focus(index);
      return;
    }
    const next = chars.length > 1 ? value.slice(0, index) + chars : value.slice(0, index) + chars + value.slice(index + 1);
    const clean = commit(next);
    focus(Math.min(index + chars.length, clean.length, length - 1));
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      commit(value.slice(0, index - 1) + value.slice(index));
      focus(index - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focus(Math.min(index + 1, value.length));
    }
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    const clean = commit(value.slice(0, index) + pasted);
    focus(Math.min(clean.length, length - 1));
  };

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="flex justify-center gap-2 sm:gap-2.5">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          // Clicking past the first empty box jumps back to it. (Not done on focus: focus also
          // moves programmatically while typing, before the new value has rendered.)
          onMouseDown={(e) => {
            if (i > value.length) {
              e.preventDefault();
              focus(value.length);
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          className={cn(
            "size-11 min-w-0 rounded-lg border bg-surface/80 text-center text-h3 font-semibold tabular-nums shadow-xs outline-none sm:size-13",
            "transition-[border-color,box-shadow,background-color] duration-micro ease-standard",
            "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/30",
            digit && "border-primary/40 bg-primary-subtle/30",
            invalid && "border-error ring-error/20",
            disabled && "opacity-60",
          )}
        />
      ))}
    </div>
  );
}
