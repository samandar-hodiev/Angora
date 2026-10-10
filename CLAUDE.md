# Engora — AI English coach

Monorepo. Learners study English (grammar, lexicon, four skills, mock exam, IELTS) with an AI
coach; the owner and staff run everything from the Owner console.

## Layout

| Path | What |
|---|---|
| `apps/api` | Go modular monolith (gin + pgx, PostgreSQL, Redis). `cmd/server` API, `cmd/worker` jobs, `cmd/migrate`, `cmd/seed` |
| `apps/api/internal/<module>` | One folder per domain (grammar, vocabulary, speaking, mockexam, owner, authz, ai, …). Routes are registered in `internal/app/router.go`, background jobs in `internal/app/jobs.go` |
| `apps/api/migrations` | Numbered SQL pairs `0000NN_name.{up,down}.sql`. Create with `make migrate-create name=…` |
| `apps/web` | Next.js app — read `apps/web/AGENTS.md` first (this Next.js version differs from training data) |
| `apps/web/src/app` | Routes: `(marketing)` landing, `(auth)` login/register, `(journey)` onboarding + placement, `app/` learner dashboard, `owner/` owner console, `admin/` legacy admin |
| `apps/web/src/features/<area>` | Feature code (views, hooks, API calls) used by the routes |
| `apps/web/src/config/navigation.ts` | Learner sidebar |
| `apps/web/src/features/owner/components/nav.ts` | Owner sidebar |
| `packages/*` | Shared `ui`, `types`, `validation`, `config` |
| `docs/` | `architecture`, `api`, `product` (roadmap) |

## How the two sides connect

The owner publishes content in **Content CMS** (`/owner/content/*`); the learner side
(`/app/*`) only reads what is published. Grammar, Lexicon, Practice (speaking / writing /
reading / listening), Mock exam, IELTS and Placement all work this way, so a change to one of
them usually touches the API module, the owner CMS view and the learner view together.
Settings, profile, staff and similar pages belong to one side only.

## Rules that are easy to break

- Owner sidebar `requires` in `nav.ts` must stay in sync with `grantable` in
  `apps/api/internal/owner/visibility.go`. Every key the Roles & access page can send,
  including parent pages like `/owner/content`, must be in `grantable`, or saving fails with
  "Invalid request".
- Authorization is enforced in the API (`internal/authz`); hiding something in the web app is
  only cosmetic.
- Modules talk through small interfaces declared by the consumer, never by reading another
  module's tables.
- Never point `TEST_DATABASE_URL` at the dev database — integration tests migrate it down and
  up and erase the data.
- The checkout is `~/Desktop/Angora.nosync` so iCloud never offloads it; `~/Desktop/Angora`
  is a symlink to it, so both paths are the same repo (see `infrastructure/scripts/icloud-guard.sh`).

## Commands

```bash
make dev          # API + worker + web together
make api          # API only, http://localhost:8000
make web          # web only, http://localhost:3001
make infra        # postgres + redis in docker
make migrate-up
make test-api     # go test ./...
make test-web
make lint         # go vet + eslint
make typecheck
```

Single Go package: `cd apps/api && go test ./internal/<module>/...`.
After changing Go code, restart the running API so the change is served.

## Git

- Commit messages: conventional prefix + Uzbek description, e.g.
  `fix(owner): Content CMS ruxsatini berish saqlanmayotgan edi`.
- Commit and push each finished task; the pre-push hook (`make gitpulse-hook`) notifies
  GitPulse on localhost:8080, which posts to Telegram.

## Sessions

Claude sessions are split by area under the ENGORA sidebar group and numbered:
`0.xx` landing, `1.xx` auth & onboarding, `2.xx` learner-only, `3.xx` shared owner ↔ learner
(through Content CMS), `4.xx` owner-only. Stay inside the session's area; cross-area work
belongs in its own session.
