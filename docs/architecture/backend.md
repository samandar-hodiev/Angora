# Backend architecture

Go 1.25 · Gin · pgx/v5 · go-redis/v9 · golang-migrate · log/slog

The API is a **modular monolith**: one deployable binary (plus a worker and a migrate binary from
the same code), organised into domain modules with explicit boundaries. It is deliberately not
split into microservices; modules can be extracted later if a real scaling need appears.

## Layout

```text
apps/api/
├── cmd/
│   ├── server/        HTTP API entrypoint (graceful shutdown)
│   ├── worker/        background job processor
│   └── migrate/       up | down | version | force | create
├── config/            env-based configuration + validation (the only os.Getenv user)
├── migrations/        numbered SQL migrations, embedded into the binary
├── pkg/               domain-free helpers
│   ├── apperr/        typed client-safe errors with stable codes
│   ├── httpx/         response envelope, JSON/query binding, validation messages
│   └── logger/        slog setup + request-scoped logger in context
└── internal/
    ├── app/           composition root: builds infrastructure, services and the router
    ├── platform/      database, cache, middleware, ratelimit, observability
    ├── auth/          register, login, refresh rotation, logout, Authenticate middleware
    ├── authz/         roles → permissions, RequirePermission middleware
    ├── users/         accounts
    ├── profiles/      learner profile
    ├── learning/      skills, levels, content catalogue
    ├── subscriptions/ plans, entitlements, usage limits
    ├── ai/            provider interface, gateway, usage/cost recording, result schema
    ├── storage/       ObjectStorage (local, S3, R2) + upload validation
    ├── jobs/          queue interface, Redis queue, worker, job polling endpoint
    ├── audit/         audit trail
    ├── health/        liveness / readiness
    └── speaking, writing, reading, listening, vocabulary, grammar, pronunciation,
        ielts, progress, mistakes, recommendations, payments   ← reserved (doc.go)
```

## Module shape

A module owns its tables and exposes:

- **types** (models / DTOs),
- a **repository** (SQL, pgx) behind an interface when another layer needs to fake it,
- a **service** holding business rules,
- a **handler** with `RegisterRoutes(v1 *gin.RouterGroup)`.

Cross-module dependencies are expressed as small interfaces declared by the *consumer*
(e.g. `auth.UserStore` is the slice of `users` that auth needs). Only `internal/app` imports every
module.

## Configuration

`config.Load()` reads environment variables (and `.env` files outside production), validates them
all at once and fails fast with every problem listed. Production refuses the mock AI provider,
local storage, short JWT secrets and empty CORS origins. See `.env.example` for every variable.

## Errors

Services return `*apperr.Error` (code + client message + optional details + internal cause).
Handlers call `httpx.Fail(c, err)`. The `Errors` middleware is the single place that renders
errors:

- known `apperr` codes map to HTTP status and are shown as-is;
- anything else becomes `INTERNAL_ERROR` with a generic message;
- 5xx causes are sent to the `ErrorReporter` (structured log today, Sentry-ready interface);
- panics are recovered and reported with a stack trace, never exposed.

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid request",
  "details": { "fields": { "email": "must be a valid email address" } }, "request_id": "…" } }
```

## Authentication

- **Passwords**: Argon2id (m=64MiB, t=3, p=2) in PHC format; parameters are stored per hash.
- **Access token**: HS256 JWT, 15 min, claims `sub`, `role`, `sid` (session family), `iss`, `aud`.
  Algorithm, issuer, audience and expiry are enforced.
- **Refresh token**: 256-bit random, stored as SHA-256, 30 days, **rotated on every refresh**.
  Presenting a rotated token revokes the whole family (theft detection).
- Unknown email and wrong password are indistinguishable (same message, same hashing work).
- Auth endpoints are rate-limited per client IP (Redis fixed window).
- `X-Client-Platform: web|ios|android` is recorded on sessions for security review only.

## Authorization

Roles are rows in `roles` and bundles of permissions in `internal/authz`. Code checks permissions
(`authz.RequirePermission(authz.PermUsersRead)`), never role names. Adding `TEACHER` means one
migration row and one map entry. Entitlements (what a plan includes) are separate from permissions
(what a role may do).

## Observability

- Structured JSON logs (`LOG_FORMAT=json`) with `request_id`, route template, status, latency,
  user id.
- `X-Request-ID` accepted from clients (validated) or generated, echoed in responses and error bodies.
- In-process HTTP metrics at `GET /api/v1/admin/system/metrics` (admin only).
- AI usage and cost per call in `ai_requests`, daily roll-up in `ai_usage`.
- Audit trail in `audit_logs` (registration, logins, failed logins, token reuse, profile changes).

## Redis usage

Cache (`cache.GetOrLoad`), rate limiting, job queue and job state, future temporary tokens.
Keys are namespaced `engora:<concern>:…`. PostgreSQL remains the source of truth.

## Background jobs

`jobs.Queue` (Redis implementation with BLMOVE reliable queue) + `jobs.Worker` (concurrency,
timeouts, panic recovery, retries up to `MaxAttempts`, permanent-error short-circuit, dead-letter
list). Handlers are registered in `cmd/worker/main.go`. Clients poll `GET /api/v1/jobs/:id`.

Planned improvements: delayed retries (sorted set), a reaper for jobs stranded in the processing
list after a crash, and push notifications on completion.

## Testing

```bash
make test-api                  # unit tests (no external services)
make test-api-integration      # + PostgreSQL and Redis integration tests
```

Covered: configuration, password hashing, JWT validation (incl. `alg=none`), register/login/
refresh rotation/reuse detection/logout, HTTP auth flow, validation messages, error rendering and
leak prevention, panic recovery, CORS and security headers, RBAC middleware, rate limiting,
entitlement resolution and usage limits, AI gateway routing/cost/error hiding, OpenAI adapter
against a fake server, AI result validation, storage keys/path traversal/upload sniffing, job
worker retries/permanent failures, database migrations up→down→up, Redis cache and queue.
