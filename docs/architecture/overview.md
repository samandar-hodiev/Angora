# Architecture overview

Engora is an AI English coach delivered on web first and on iOS/Android later. Every client
talks to one backend, one database and one account system.

```text
             Next.js web            React Native (iOS / Android, later)
                   \                         /
                    \   HTTPS  /api/v1/...  /
                     ▼                     ▼
               ┌─────────────────────────────────┐
               │  Go API  (Gin, modular monolith) │──── AI providers (via AI gateway)
               │  + background worker             │──── Object storage (R2 / S3)
               └───────────────┬─────────────────┘
                               │
                 PostgreSQL (source of truth) + Redis (cache, rate limits, jobs)
```

## Principles

| Principle | How it shows up in the code |
| --- | --- |
| Modular | Backend domains live in `apps/api/internal/<module>`; frontend features in `apps/web/src/features/<feature>`. |
| Replaceable | AI providers, object storage, error tracking and the job queue sit behind interfaces. |
| Testable | Business rules are plain Go/TS with interfaces for I/O; integration tests run against real Postgres/Redis when configured. |
| Versioned | HTTP routes under `/api/v1`; AI results carry schema/model/prompt/rubric/analysis versions; schema changes are numbered migrations. |
| Provider-agnostic | Application code depends on `ai.Gateway` and `storage.ObjectStorage`, never on OpenAI or S3 SDKs. |
| Platform-agnostic | The API has no web-only behaviour. Tokens are returned in JSON; how a client stores them is the client's concern. |

## Repository layout

```text
engora/
├── apps/
│   ├── api/                 Go API + worker + migrations (modular monolith)
│   └── web/                 Next.js App Router client
├── packages/
│   ├── types/               API contract types shared by TS clients (web now, React Native later)
│   ├── validation/          Zod schemas mirroring API validation rules
│   ├── ui/                  Design tokens (TS for RN, CSS theme for web)
│   └── config/              Shared TypeScript configs
├── infrastructure/
│   ├── docker/              Dockerfiles for api and web
│   └── scripts/             Developer scripts (GitPulse push notifications)
├── docs/                    Architecture, API, database, AI and product docs
├── docker-compose.yml       Full local stack
└── Makefile                 Developer commands
```

### Deviations from the initial brief (and why)

1. **shadcn/ui components live in `apps/web/src/components/ui`, not `packages/ui`.**
   The components are DOM/Tailwind-specific and cannot be used by React Native. `packages/ui`
   holds the design *tokens*, which both web and mobile can share. If a second web app (e.g. an
   admin console) appears, the components can move into a `packages/web-ui` package then.
2. **npm workspaces instead of pnpm/Turborepo.** npm ships with Node, needs no extra tooling, and
   the monorepo is small. Turborepo can be added later without restructuring.
3. **One `content_items` table instead of one table per content type.** Speaking topics, writing
   tasks, reading passages, listening exercises and exam questions share metadata (level, skill,
   topic, difficulty, tags, status) that must be filterable; their type-specific payload lives in a
   versioned JSONB `body`. New content types need no migration.
4. **An `ai_analyses` table in addition to the listed tables.** It stores structured, versioned AI
   results once, for any subject (speaking session, writing submission, …).
5. **`entitlements`, `plan_entitlements`, `usage_counters` and `refresh_tokens` tables** were added
   to implement subscription entitlements and refresh-token rotation properly.

## Request lifecycle (API)

```text
request → RequestID → AccessLog → Metrics → Recovery → SecurityHeaders → CORS → BodyLimit → Errors
        → /api/v1 group: Authenticate (Bearer JWT, optional)
        → route middleware: RequirePermission / RateLimit / RequireFeature
        → handler → service → repository → PostgreSQL
        ← httpx envelope { success, data | error, meta }
```

## Long-running work

AI work never blocks an HTTP request:

```text
client → API validates + stores input → enqueue job (Redis) → 202 { job_id }
worker → transcribe / analyse via AI gateway → save result (PostgreSQL) → job state (Redis)
client → GET /api/v1/jobs/:id until succeeded | failed   (push/SSE can be added on the same state)
```

## Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| AI cost grows faster than revenue | Every call is recorded in `ai_requests` with tokens, audio seconds, estimated cost and latency; `ai_usage` rolls up daily; plans enforce `usage_counters` limits. |
| Vendor lock-in on AI or storage | Gateway/provider and ObjectStorage interfaces; routing per task is configuration. |
| Breaking mobile apps with API changes | `/api/v1` is frozen once mobile ships; breaking changes go to `/api/v2` handlers over the same services. Error `code`s are stable. |
| Refresh-token theft | Tokens hashed at rest, rotated on use, reuse revokes the session family; web keeps refresh tokens in httpOnly cookies. |
| Redis outage | Rate limiter fails open; caches fall back to the database; Redis holds no permanent data. |
| Monolith grows tangled | Modules talk through consumer-defined interfaces; only `internal/app` wires modules together. |
| Rate limiting sees proxy IPs | `TRUSTED_PROXIES` must list only real proxies/load balancers in production. |

See also: [backend](backend.md) · [frontend](frontend.md) · [database](database.md) · [AI](ai.md) · [API](../api/README.md) · [roadmap](../product/roadmap.md)
