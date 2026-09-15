# Design system

Engora should feel **simple at first glance, powerful after exploration** — premium without
being flashy, AI-native without looking robotic. Inspiration for restraint and hierarchy comes
from products like Linear, Notion and Apple; nothing is copied.

```text
Foundations (packages/ui tokens)
   ↓
Components (apps/web/src/components/ui)        Button, Input, Tabs, Dialog, Sheet, Toast …
   ↓
Patterns   (components/common, components/learning)   ErrorState, EmptyState, AudioRecorder, ScoreCard …
   ↓
Pages      (features/*, app/*)
```

The same layers map to future Figma pages: Foundations · Components · Patterns · Pages.

## Visual balance

| Share | Treatment | Where |
| --- | --- | --- |
| ~80% | Minimal: surface + border + text | Almost everything: forms, reading, writing, tables, settings, exam mode |
| ~15% | Glass (`glass` utility) | Floating nav (marketing header, mobile bottom bar), AI Coach insight, premium CTA, toasts, IELTS upgrade card |
| ~5% | Liquid (`LiquidBackground`, `liquid-field`) | AI moments only: AI insight, AI processing, hero product preview, final CTA |

Never glass/liquid: reading articles, writing editor, **exam mode**, settings forms, large tables,
every card, buttons.

## Foundations

Source of truth: `packages/ui/src/tokens.ts` (TS, shareable with React Native) mirrored by
`packages/ui/src/theme.css` (CSS variables + Tailwind v4 `@theme`).

### Color (OKLCH, one accent)

| Token | Utility |
| --- | --- |
| background / foreground | `bg-background`, `text-foreground` |
| surface, surface-elevated, surface-hover, surface-active | `bg-surface`, `bg-surface-elevated`, `bg-surface-hover`, `bg-surface-active` |
| border, border-subtle | `border-border`, `border-border-subtle` |
| primary, primary-hover, primary-active, primary-foreground | `bg-primary`, `hover:bg-primary-hover`, `active:bg-primary-active`, `text-primary-foreground` |
| primary-subtle (+ foreground) | `bg-primary-subtle`, `text-primary-subtle-foreground` |
| success, warning, error, info | `text-success`, `bg-error`, … |
| text-primary, text-secondary, text-muted, text-disabled | `text-fg`, `text-fg-secondary`, `text-fg-muted`, `text-fg-disabled` |

Brand accent: green `oklch(69.6% 0.17 162.48)` in both themes (dark text on green fills for contrast). Dark is the default theme. Visual rule: ~90% dark/neutral, ~10% green light (CTAs, progress, labels, icon accents, ambient glow). shadcn
aliases (`card`, `muted`, `accent`, `destructive`, …) point at the same tokens.

### Dark mode

Landing surfaces use `glass-card`, `glass-panel`, `glass-hover`, `glass-button` and `btn-liquid` (Button `variant="liquid"`). The public site is translated (English default, O‘zbek, Русский) via `apps/web/src/locales` and `features/marketing/i18n.tsx`; the choice persists in localStorage. Product terms (IELTS, AI, Speaking, Writing, Reading, Listening, AI Coach) stay untranslated.


Light / Dark / System. Dark is its own palette: layered surfaces
(background → surface → surface-elevated), subtle borders, muted secondary text and a lighter,
less saturated accent. An inline script applies the theme before first paint (no flash). The
preference is stored locally and on the learner profile (`preferences.appearance`), so it follows
the learner across devices.

### Typography

Inter everywhere. Utilities: `text-display`, `text-h1`–`text-h4`, `text-body-lg`, `text-body`,
`text-body-sm`, `text-caption`, `text-label`, `font-mono`. Hierarchy comes from weight and
spacing more than size.

### Spacing, radius, shadow

- Spacing: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96 (Tailwind 1–24 steps only).
- Radius: sm 6 · md 8 (controls) · lg 12 (cards) · xl 16 (large surfaces) · full (avatars, dots).
  No pill-everything.
- Elevation: border + surface contrast first; shadows `xs`–`lg` are very soft.

### Motion

| Kind | Duration | Utility |
| --- | --- | --- |
| Micro (hover, press, toggle) | 120ms | `duration-micro` |
| Normal (panels, dialogs, steps) | 240ms | `duration-normal` |
| Emphasis (progress fills, completion) | 420ms | `duration-emphasis` |
| Ambient (AI, liquid) | 8–14s | `animate-liquid`, `animate-breathe` |

Easing: `ease-standard`, `ease-emphasized`. `prefers-reduced-motion` disables animation globally;
every animated component is fully usable without it.

### Icons

Lucide only (stroke icons). No emoji, no filled/brand icon mixes. Skill icons are mapped in
`components/learning/skill-icon.tsx` with a fallback for skills added later.

## Components

`components/ui`: Button (+ `loading`), IconButton (requires `label`), Input, Textarea,
NativeSelect, Checkbox, Radio/RadioGroup, Switch, OptionCard, Tabs, Card, Badge, Avatar,
DropdownMenu, Dialog, Sheet, Tooltip, Toast, Progress, ProgressRing, Meter, BarChart, Sparkline,
Stat, Skeleton, Alert, Separator.

`components/common`: ErrorState, EmptyState, InlineLoader, OfflineBanner, FormField, PageHeader,
LiquidBackground, Brand.

`components/learning`: AudioPlayer, AudioRecorder, Waveform, ScoreCard, SkillCard, AIInsight,
MistakeCard, VocabularyCard, RecommendationCard, AIProcessingState.

All components support light/dark, are responsive, keyboard-accessible (Radix primitives), and
expose accessible names, states (`aria-pressed`, `aria-current`, `aria-invalid`) and live regions
where content changes.

## Patterns

- **Loading**: skeletons shaped like the content; AI work uses `AIProcessingState` with named
  steps, never an anonymous spinner.
- **Empty**: say what will make content appear and offer the next action.
- **Error**: say what happened, reassure ("your audio is safe"), offer retry. Internal details are
  never shown.
- **Not yet available**: controls render in their final place but disabled, with a tooltip saying
  when they arrive. No fake functionality, no invented data; examples are labelled as examples.
- **Entitlements**: `EntitlementGate` / `useFeature` read entitlements from the API — never plan
  names.
- **Estimates**: IELTS scores are always "Estimated IELTS band".

## Information architecture

Public site (SEO, metadata, Open Graph, sitemap, JSON-LD): `/`, `/features`, `/speaking`,
`/writing`, `/reading`, `/listening`, `/ielts`, `/pricing`, `/about`, `/faq`, `/blog`, `/contact`,
`/privacy`, `/terms`.

Auth: `/login`, `/register`, `/forgot-password`, `/reset-password`. Onboarding: `/onboarding`
(goal → level → skills → daily time → plan).

App (sidebar on desktop, floating glass bottom nav on mobile): `/app/dashboard`, `/app/learn`,
`/app/speaking`, `/app/writing`, `/app/reading`, `/app/listening`, `/app/vocabulary`,
`/app/grammar`, `/app/pronunciation`, `/app/ai-coach`, `/app/ielts`, `/app/ielts/exam` (focus
mode, no shell), `/app/progress`, `/app/mistakes`, `/app/history`, `/app/profile`,
`/app/settings`, `/app/subscription`.

Admin (denser, same system): `/admin`, `/admin/users`, `/admin/subscriptions`, `/admin/revenue`,
`/admin/content`, `/admin/ai-usage`, `/admin/ai-costs`, `/admin/reports`, `/admin/support`,
`/admin/system`.

Web navigation differs from the future mobile app (sidebar vs. bottom tabs), but both consume the
same API resources: `/progress`, `/learning-plan`, `/mistakes`, `/subscriptions/me`, …
