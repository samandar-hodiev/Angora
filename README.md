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
make api              # terminal 1 → http://localhost:8000
make web              # terminal 2 → http://localhost:3001
make worker           # terminal 3 (optional) → background jobs
```

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
