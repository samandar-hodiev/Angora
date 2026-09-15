# Frontend architecture

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui (Radix) ·
TanStack Query · React Hook Form · Zod · Vitest + Testing Library

The web app is **one client of the Engora API**. It holds no business rules and no data of its
own; everything a learner sees comes from `/api/v1`, so the future React Native app can show the
same state.

## Layers

```text
src/
├── app/                      Routes only: layouts, pages, route handlers. Thin.
│   ├── page.tsx              Public landing
│   ├── (auth)/login|register Guest-only pages
│   ├── app/                  Authenticated area (/app/...), AuthGuard + AppShell
│   │   ├── dashboard, learn, profile, subscription, settings
│   │   └── [area]            Fallback for planned areas and API-defined skills
│   └── api/session/[action]  Web-only session bridge (httpOnly refresh cookie)
├── features/<feature>/       Feature modules
│   ├── api.ts                API calls for the feature (uses the shared apiClient)
│   ├── hooks.ts              TanStack Query hooks (server state)
│   ├── lib/                  Pure feature logic (tested)
│   └── components/           Feature UI
├── components/
│   ├── ui/                   Design-system primitives (shadcn/ui, semantic tokens only)
│   ├── common/               Cross-feature presentational pieces (states, form field, header)
│   └── layout/               App shell, navigation
├── config/navigation.ts      App structure (not content)
├── lib/
│   ├── api/                  Centralised API client + ApiError
│   ├── query/                QueryClient defaults + query key factory
│   ├── forms/                API error → form field mapping
│   └── env.ts                Validated public env + API_VERSION
└── providers/                Client providers (React Query, session bootstrap)
```

Rules enforced by convention and lint:

1. Components never call `fetch`; features call `apiClient` in `api.ts`; components use hooks.
2. No learning content, plans, prices or limits in components — they are fetched.
3. No plan-code checks (`plan === "pro"`). UI asks `hasFeature(entitlements, "ai_coach.chat")`.
4. No AI provider knowledge in the client.
5. `strict` TypeScript with `noUncheckedIndexedAccess`; `any` is a lint error.

## API client

`src/lib/api/client.ts` (`createApiClient`):

- builds versioned URLs: `${NEXT_PUBLIC_API_URL}/api/${version}${path}`; `API_VERSION` lives in
  `lib/env.ts`, and a single call can opt into another version (`{ version: "v2" }`) during a
  migration;
- sends `Authorization: Bearer <access token>` and `X-Client-Platform: web`;
- unwraps `{ success, data, meta }` and throws `ApiError` (`status`, `code`, `fieldErrors`,
  `requestId`) for every failure, including network errors and non-JSON responses;
- on `401` refreshes the session once (single-flight) and retries.

## Session model (web)

| Token | Where it lives | Why |
| --- | --- | --- |
| Access token (15 min) | Memory only (`sessionStore`) | Not readable from storage by injected scripts. |
| Refresh token (30 days) | `httpOnly`, `SameSite=Strict` cookie, path `/api/session` | Browser JS never sees it. |
| `engora_session=1` hint | Plain cookie | Lets anonymous visitors skip a pointless refresh call. |

`/api/session/{login,register,refresh,logout}` is a thin Next.js route handler that forwards to the
Go API and moves the refresh token into the cookie. It requires an `X-Engora-Session` header, which
cross-site forms cannot send (CSRF defence). The Go API stays platform-agnostic; mobile apps call
`/api/v1/auth/*` directly and store tokens in the keychain.

## Server state

TanStack Query owns server state. Keys come from `lib/query/keys.ts`. Defaults: 60s stale time, no
retries on 4xx, cache cleared on login/logout so one user's data never shows for another.

## Forms

React Hook Form + `zodResolver` with schemas from `@engora/validation` (the same limits as the
API). Server validation errors are mapped onto fields with `applyApiErrors`. `FormField` wires
`id`, `aria-invalid` and `aria-describedby` automatically.

## Design system

See [design-system.md](design-system.md) for tokens, dark mode, typography, motion, the
glass/liquid rules, components, patterns and the full route map.

Route groups: `(marketing)` public site, `(auth)` guest pages, `onboarding`, `app/(shell)` with the
app shell, `app/(focus)` for exam mode without navigation, `admin` for the owner console.

## Adding a feature

1. Add API types to `packages/types` (and schemas to `packages/validation` if there is input).
2. Create `src/features/<name>/api.ts` and `hooks.ts`; add query keys.
3. Build components in the feature folder from `components/ui` primitives.
4. Add a route under `src/app/app/<name>/page.tsx` (it overrides the `[area]` fallback).
5. Gate by entitlement with `EntitlementGate` or `useFeature` when the plan matters.

## Testing

```bash
npm test                   # all workspaces
npm test -w @engora/web    # web only
```

Covered: API client (URL versioning, headers, envelope, error mapping, refresh/retry, network
errors), redirect sanitisation, entitlement helpers, login form (client validation, success,
API error), shared Zod schemas.
