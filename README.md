# Engora

**Your AI English Coach** — a platform for improving English through practice, AI analysis,
feedback, weakness detection and personalised practice. Web first; iOS and Android will use the
same API, database and accounts.

This repository contains the **production foundation**: a modular Go API, PostgreSQL schema and
migrations, Redis, authentication and authorization, subscription entitlements, a
provider-agnostic AI layer, object storage, background jobs, and a Next.js web client with a design
system.

| | |
| --- | --- |
| Web | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, React Hook Form, Zod |
| API | Go 1.25, Gin, pgx, go-redis, golang-migrate, slog |
| Data | PostgreSQL 15+ (source of truth), Redis 7 (cache, rate limits, jobs) |
| Storage | Local filesystem (dev), AWS S3 / Cloudflare R2 |
| Infra | Docker, Docker Compose, env-based configuration |

## Repository

```text
apps/api          Go API, worker, migrations          → docs/architecture/backend.md
apps/web          Next.js web client                  → docs/architecture/frontend.md
packages/types    API contract types (TS)
packages/validation  Zod schemas mirroring API validation
packages/ui       Design tokens (TS + Tailwind theme)
packages/config   Shared tsconfig
infrastructure    Dockerfiles, scripts
docs              Architecture, database, AI, API, roadmap
```

## Quick start (daily)

Once the project is set up (see *Option B* below for the first time), this is all it takes:

```bash
make dev
```

It checks that PostgreSQL and Redis are reachable, applies pending migrations and starts the
**API**, the **worker** and the **web app** in one terminal, with each line prefixed by
`[api]`, `[worker]` or `[web]`. On macOS it also keeps the machine awake (`caffeinate`) while it
runs, so the servers do not stop when the laptop would otherwise sleep. **Ctrl+C** stops all three.

| Page | URL |
| --- | --- |
| Landing page | http://localhost:3001 |
| Learner sign-in / sign-up | http://localhost:3001/login · http://localhost:3001/register |
| Owner Console sign-in | http://localhost:3001/owner/login |
| API health | http://localhost:8000/health |

`NO_WORKER=1 make dev` skips the worker. If a port is taken, `make dev` says which one; free it
with `lsof -iTCP:8000 -sTCP:LISTEN` (or `3001`) and stop that process.

**Signing in locally**

- **Email codes** are sent for real when `MAIL_PROVIDER=smtp` (Gmail: `SMTP_*` in `.env`, with an
  App Password). With `MAIL_PROVIDER=log` nothing is sent and the code is shown on the page
  instead. Codes expire after **2 minutes**; a new one can be requested after 45 seconds.
- **Owner Console**: enter the address in `OWNER_EMAIL`; a code is emailed to it. The owner account
  is created on the first sign-in. The owner has no password and cannot reset one.
- **Staff** sign in with email + password on the same page, and can use *Forgot password?*.
- **Google** sign-in needs `GOOGLE_CLIENT_IDS` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and
  `http://localhost:3001` listed under *Authorized JavaScript origins* for that client in the
  Google Cloud Console.

## Prerequisites

- **Docker** with Docker Compose v2 — for the one-command setup, or
- **Go 1.25+**, **Node.js 22+ / npm 10+**, **PostgreSQL 15+**, **Redis 7+** — for local development

## Option A — run everything with Docker

```bash
cp .env.example .env
# set a JWT secret (32+ chars):
sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')|" .env && rm .env.bak

docker compose up --build
```

| Service | URL |
| --- | --- |
| Web | http://localhost:3001 |
| API | http://localhost:8000 (health: http://localhost:8000/health) |
| PostgreSQL | `localhost:5433` (user/password/db from `.env`) |
| Redis | `localhost:6379` |

Compose starts `postgres` and `redis`, runs the `migrate` job, then starts `api`, `worker` and
`web`. Stop with `docker compose down` (add `-v` to delete data).

## Option B — local development

```bash
make setup            # creates .env with a random JWT secret, installs npm + Go deps
make infra            # postgres + redis in docker (or use your own, see below)
make migrate-up       # apply database migrations
make dev              # API + worker + web in one terminal (Ctrl+C stops all)
```

Or run them separately, one per terminal: `make api` (http://localhost:8000), `make web`
(http://localhost:3001) and, optionally, `make worker`.

Using an existing local PostgreSQL/Redis instead of docker: create a database and point `.env` at it.

```bash
createdb engora
# .env
DATABASE_URL=postgres://<user>@localhost:5432/engora?sslmode=disable
REDIS_URL=redis://localhost:6379/0
```

Verify:

```bash
curl -s localhost:8000/health | jq
# { "success": true, "data": { "status": "ok", "checks": { "database": {"status":"up"}, "redis": {"status":"up"} } } }
```

Then open http://localhost:3001, create an account and you land in the app dashboard, which loads
your profile, plan and skills from `/api/v1`.

### Sample data (development)

```bash
make seed-demo                          # sample content + demo learner with progress, mistakes, vocabulary
                                        #   demo@engora.dev / engora-demo-2026
make promote email=demo@engora.dev      # give an account the ADMIN role (then /admin)
```

`make seed` loads only the sample content. Seeding refuses to run with `APP_ENV=production`.

## Environment variables

All configuration lives in one root `.env` (read by compose, the API and the web app). Every
variable is documented in [`.env.example`](.env.example). Key ones:

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `development` \| `test` \| `production` (production rejects unsafe settings) |
| `APP_PORT` | API port (default 8000) |
| `DATABASE_URL` / `REDIS_URL` | Connections |
| `JWT_SECRET` | ≥ 32 random characters; required |
| `CORS_ALLOWED_ORIGINS` | Browser origins allowed to call the API |
| `TRUSTED_PROXIES` | Proxies whose `X-Forwarded-For` is trusted (rate limiting) |
| `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY` | AI provider selection (`mock` for development) |
| `STORAGE_PROVIDER`, `STORAGE_*` | `local` or `s3` (S3 / Cloudflare R2 via `STORAGE_ENDPOINT`) |
| `NEXT_PUBLIC_API_URL` | API origin used by the browser |
| `API_INTERNAL_URL` | API origin used by Next.js server code |

Never commit `.env`, API keys, database passwords or JWT secrets.

## Database migrations

```bash
make migrate-up                              # apply
make migrate-down                            # roll back one
make migrate-version                         # current version
make migrate-create name=add_placement_tests # new NNNNNN_name.{up,down}.sql pair
```

Schema changes are migrations only. See [docs/architecture/database.md](docs/architecture/database.md).

## Tests and checks

```bash
make test                   # Go unit tests + web/package tests
make test-api-integration   # Go tests incl. PostgreSQL + Redis (uses a disposable engora_test DB)
make lint                   # go vet + eslint
make typecheck              # TypeScript
make build                  # API binaries + production web build
```

Integration tests need a **throwaway** database (they drop all tables):

```bash
createdb engora_test
make test-api-integration TEST_DATABASE_URL=postgres://<user>@localhost:5432/engora_test?sslmode=disable
```

## Documentation

- [Architecture overview](docs/architecture/overview.md) — principles, layout, decisions, risks
- [Backend](docs/architecture/backend.md) · [Frontend](docs/architecture/frontend.md)
- [Database](docs/architecture/database.md) · [AI](docs/architecture/ai.md)
- [API reference](docs/api/README.md)
- [Roadmap](docs/product/roadmap.md)

## Push notifications (GitPulse)

Pushes to GitHub can be announced in Telegram by the local GitPulse service
(`~/Desktop/gitpulse`). Install the hook once per clone:

```bash
make gitpulse-hook
```

After a successful `git push`, the hook signs the commit payload with GitPulse's webhook secret
and posts it to `http://localhost:8080/webhook/github`. If GitPulse is not running, the push is
unaffected.
