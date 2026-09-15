/**
 * Engora design tokens — the single source of design values.
 *
 *   Foundations (this file) → Components (apps/web/src/components/ui) → Patterns → Pages
 *
 * Web consumes tokens through theme.css (CSS variables + Tailwind v4 theme). The future
 * React Native app imports this module directly, so both clients share one visual language.
 * Keep theme.css in sync when changing values here.
 *
 * Colors are OKLCH. One brand accent (indigo-violet); everything else is neutral or
 * semantic (success / warning / error / info).
 */

const light = {
  background: "oklch(0.99 0.002 270)",
  foreground: "oklch(0.2 0.018 270)",

  surface: "oklch(1 0 0)",
  surfaceElevated: "oklch(1 0 0)",
  surfaceHover: "oklch(0.972 0.003 270)",
  surfaceActive: "oklch(0.948 0.006 270)",

  border: "oklch(0.915 0.005 270)",
  borderSubtle: "oklch(0.95 0.003 270)",

  primary: "oklch(0.52 0.165 276)",
  primaryHover: "oklch(0.48 0.165 276)",
  primaryActive: "oklch(0.44 0.155 276)",
  primaryForeground: "oklch(0.99 0.002 270)",
  primarySubtle: "oklch(0.962 0.022 276)",
  primarySubtleForeground: "oklch(0.42 0.13 276)",

  success: "oklch(0.58 0.12 155)",
  successForeground: "oklch(0.99 0 0)",
  warning: "oklch(0.74 0.14 72)",
  warningForeground: "oklch(0.26 0.05 72)",
  error: "oklch(0.57 0.2 25)",
  errorForeground: "oklch(0.99 0 0)",
  info: "oklch(0.58 0.11 240)",
  infoForeground: "oklch(0.99 0 0)",

  textPrimary: "oklch(0.2 0.018 270)",
  textSecondary: "oklch(0.42 0.014 270)",
  textMuted: "oklch(0.55 0.011 270)",
  textDisabled: "oklch(0.72 0.006 270)",

  ring: "oklch(0.52 0.165 276)",
  glass: "oklch(1 0 0 / 0.64)",
  glassBorder: "oklch(1 0 0 / 0.7)",
} as const;

const dark = {
  background: "oklch(0.155 0.008 270)",
  foreground: "oklch(0.955 0.004 270)",

  surface: "oklch(0.19 0.009 270)",
  surfaceElevated: "oklch(0.225 0.01 270)",
  surfaceHover: "oklch(0.235 0.01 270)",
  surfaceActive: "oklch(0.27 0.012 270)",

  border: "oklch(0.29 0.01 270)",
  borderSubtle: "oklch(0.235 0.009 270)",

  primary: "oklch(0.7 0.13 276)",
  primaryHover: "oklch(0.74 0.12 276)",
  primaryActive: "oklch(0.66 0.13 276)",
  primaryForeground: "oklch(0.16 0.01 270)",
  primarySubtle: "oklch(0.27 0.045 276)",
  primarySubtleForeground: "oklch(0.86 0.06 276)",

  success: "oklch(0.72 0.12 155)",
  successForeground: "oklch(0.16 0.01 270)",
  warning: "oklch(0.8 0.13 75)",
  warningForeground: "oklch(0.2 0.04 75)",
  error: "oklch(0.68 0.18 25)",
  errorForeground: "oklch(0.16 0.01 270)",
  info: "oklch(0.72 0.1 240)",
  infoForeground: "oklch(0.16 0.01 270)",

  textPrimary: "oklch(0.955 0.004 270)",
  textSecondary: "oklch(0.8 0.008 270)",
  textMuted: "oklch(0.65 0.01 270)",
  textDisabled: "oklch(0.48 0.008 270)",

  ring: "oklch(0.7 0.13 276)",
  glass: "oklch(0.23 0.01 270 / 0.62)",
  glassBorder: "oklch(1 0 0 / 0.09)",
} as const satisfies Record<keyof typeof light, string>;

export const colors = { light, dark } as const;

/** 4px base. Use only these steps for padding, gaps and margins. */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

/** Restrained rounding: controls md, cards lg, large surfaces xl. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const typography = {
  fontFamily: { sans: "Inter", mono: "JetBrains Mono" },
  /** size / line height in px, tracking in em, weight */
  scale: {
    display: { size: 56, lineHeight: 60, tracking: -0.035, weight: 600 },
    h1: { size: 32, lineHeight: 40, tracking: -0.025, weight: 600 },
    h2: { size: 24, lineHeight: 32, tracking: -0.02, weight: 600 },
    h3: { size: 20, lineHeight: 28, tracking: -0.015, weight: 600 },
    h4: { size: 17, lineHeight: 24, tracking: -0.01, weight: 600 },
    bodyLarge: { size: 18, lineHeight: 28, tracking: 0, weight: 400 },
    body: { size: 16, lineHeight: 24, tracking: 0, weight: 400 },
    bodySmall: { size: 14, lineHeight: 20, tracking: 0, weight: 400 },
    caption: { size: 12, lineHeight: 16, tracking: 0.01, weight: 400 },
    label: { size: 13, lineHeight: 16, tracking: 0, weight: 500 },
    mono: { size: 13, lineHeight: 20, tracking: 0, weight: 400 },
  },
} as const;

/** Border first, then surface contrast, then a very soft shadow. */
export const shadows = {
  xs: "0 1px 2px 0 oklch(0.2 0.02 270 / 0.05)",
  sm: "0 1px 3px 0 oklch(0.2 0.02 270 / 0.06), 0 1px 2px -1px oklch(0.2 0.02 270 / 0.05)",
  md: "0 6px 16px -4px oklch(0.2 0.02 270 / 0.08)",
  lg: "0 16px 40px -12px oklch(0.2 0.02 270 / 0.14)",
  glass: "0 8px 32px -12px oklch(0.2 0.03 276 / 0.18)",
} as const;

/** Motion communicates state, hierarchy, feedback, progress and AI processing only. */
export const motion = {
  duration: {
    micro: 120, // hover, press, toggle
    normal: 240, // panels, dialogs, route transitions
    emphasis: 420, // success, completion, reveal
    ambient: 8000, // AI / liquid backgrounds (disabled with reduced motion)
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.3, 0, 0, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;

/** Mobile-first min-width breakpoints (px). */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

/** Guideline for surface treatments across the product. */
export const visualBalance = { minimal: 0.8, glass: 0.15, liquid: 0.05 } as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof typeof light;
