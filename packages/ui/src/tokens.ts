/**
 * Engora design tokens — the single source of design values.
 *
 * Web consumes them through theme.css (CSS variables + Tailwind v4 theme).
 * The future React Native app imports this module directly, so both clients share one
 * visual language. Keep theme.css in sync when changing values here.
 *
 * Colors are OKLCH strings (supported by modern browsers; RN will convert at build time).
 */

export const colors = {
  light: {
    background: "oklch(0.985 0.004 264)",
    foreground: "oklch(0.21 0.03 264)",
    card: "oklch(1 0 0)",
    cardForeground: "oklch(0.21 0.03 264)",
    popover: "oklch(1 0 0)",
    popoverForeground: "oklch(0.21 0.03 264)",
    primary: "oklch(0.52 0.19 272)",
    primaryForeground: "oklch(0.985 0.004 264)",
    secondary: "oklch(0.955 0.012 264)",
    secondaryForeground: "oklch(0.27 0.04 264)",
    muted: "oklch(0.955 0.008 264)",
    mutedForeground: "oklch(0.5 0.025 264)",
    accent: "oklch(0.94 0.03 272)",
    accentForeground: "oklch(0.3 0.08 272)",
    destructive: "oklch(0.58 0.22 27)",
    destructiveForeground: "oklch(0.985 0 0)",
    success: "oklch(0.6 0.13 155)",
    successForeground: "oklch(0.985 0 0)",
    warning: "oklch(0.76 0.15 75)",
    warningForeground: "oklch(0.25 0.05 75)",
    info: "oklch(0.62 0.12 235)",
    infoForeground: "oklch(0.985 0 0)",
    border: "oklch(0.91 0.01 264)",
    input: "oklch(0.91 0.01 264)",
    ring: "oklch(0.52 0.19 272)",
    chart1: "oklch(0.52 0.19 272)",
    chart2: "oklch(0.6 0.13 155)",
    chart3: "oklch(0.76 0.15 75)",
    chart4: "oklch(0.62 0.12 235)",
    chart5: "oklch(0.64 0.2 350)",
  },
  dark: {
    background: "oklch(0.17 0.02 264)",
    foreground: "oklch(0.96 0.006 264)",
    card: "oklch(0.21 0.025 264)",
    cardForeground: "oklch(0.96 0.006 264)",
    popover: "oklch(0.21 0.025 264)",
    popoverForeground: "oklch(0.96 0.006 264)",
    primary: "oklch(0.68 0.16 272)",
    primaryForeground: "oklch(0.17 0.02 264)",
    secondary: "oklch(0.27 0.03 264)",
    secondaryForeground: "oklch(0.96 0.006 264)",
    muted: "oklch(0.27 0.03 264)",
    mutedForeground: "oklch(0.72 0.02 264)",
    accent: "oklch(0.3 0.06 272)",
    accentForeground: "oklch(0.93 0.03 272)",
    destructive: "oklch(0.65 0.2 27)",
    destructiveForeground: "oklch(0.985 0 0)",
    success: "oklch(0.7 0.13 155)",
    successForeground: "oklch(0.17 0.02 264)",
    warning: "oklch(0.8 0.14 75)",
    warningForeground: "oklch(0.2 0.04 75)",
    info: "oklch(0.72 0.11 235)",
    infoForeground: "oklch(0.17 0.02 264)",
    border: "oklch(0.3 0.025 264)",
    input: "oklch(0.32 0.025 264)",
    ring: "oklch(0.68 0.16 272)",
    chart1: "oklch(0.68 0.16 272)",
    chart2: "oklch(0.7 0.13 155)",
    chart3: "oklch(0.8 0.14 75)",
    chart4: "oklch(0.72 0.11 235)",
    chart5: "oklch(0.7 0.18 350)",
  },
} as const;

/** Base radius; components derive sm/md/lg/xl from it. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

/** 4px spacing scale. */
export const spacing = {
  0: 0,
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
} as const;

export const typography = {
  fontFamily: {
    sans: "Inter",
    mono: "JetBrains Mono",
  },
  /** [font size px, line height px] */
  size: {
    xs: [12, 16],
    sm: [14, 20],
    base: [16, 24],
    lg: [18, 28],
    xl: [20, 28],
    "2xl": [24, 32],
    "3xl": [30, 36],
    "4xl": [36, 40],
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

export const shadows = {
  sm: "0 1px 2px 0 oklch(0.21 0.03 264 / 0.06)",
  md: "0 4px 12px -2px oklch(0.21 0.03 264 / 0.08)",
  lg: "0 12px 32px -8px oklch(0.21 0.03 264 / 0.14)",
} as const;

/** Responsive breakpoints (min-width, px). Mobile-first: styles apply upward. */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorToken = keyof (typeof colors)["light"];
