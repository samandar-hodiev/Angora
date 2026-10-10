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

## Sessions — one area each

Claude sessions live under the ENGORA sidebar group, one per area. **The session title says
which area you own. Work only there.** If a task needs changes in another area, stop and name
the session that owns it (number + title) instead of doing it. Shared files (`packages/ui`,
`internal/app/router.go`, `nav.ts`, `navigation.ts`, migrations) may be touched only as far as
your own area needs. Paths below: web routes under `apps/web/src/app`, API under
`apps/api/internal`.

| Session | Owns |
|---|---|
| 0.01-Landing | `(marketing)/*`, `features/marketing` |
| 1.01-Auth · Learner | `(auth)/*` (login, register, forgot/reset password, verify email), `features/auth`, API `auth` |
| 1.02-Auth · Owner | `owner/login`, owner sign-in flow |
| 2.01-Learner · Onboarding & Placement test | `(journey)/*`, `features/onboarding`, learner side of `features/assessment`, API `onboarding`, `levels` |
| 2.02-Learner · Home Dashboard | `app/(shell)/dashboard`, `features/dashboard`, API `recommendations`, `personalization` |
| 2.03-Learner · Practice Overview | `app/(shell)/learn`, `features/practice/learn-view.tsx` |
| 2.04-Learner · AI Coach | `app/(shell)/ai-coach`, `features/practice/coach`, API `coach` |
| 2.05-Learner · Pronunciation | `app/(shell)/pronunciation`, API `pronunciation` |
| 2.06-Learner · Progress | `app/(shell)/progress`, API `progress` |
| 2.07-Learner · Mistakes | `app/(shell)/mistakes`, API `mistakes` |
| 2.08-Learner · History | `app/(shell)/history` |
| 2.09-Learner · Subscription | `app/(shell)/subscription`, `features/subscription` |
| 2.10-Learner · Settings | `app/(shell)/settings` |
| 2.11-Learner · Profile | `app/(shell)/profile`, `features/profile`, API `profiles` |
| 3.01-Learner & Owner · Content CMS | `owner/content` (Overview, All content), `cms-view`, `content-overview`, API `learning` |
| 3.02-Learner & Owner · Grammar | `owner/content/grammar`, `grammar-*` views, `app/(shell)/grammar`, `features/grammar`, API `grammar` |
| 3.03-Learner & Owner · Lexicon | `owner/content/lexicon` + vocabulary, `vocabulary-view`, `irregular-verbs-view`, `app/(shell)/{vocabulary,phrases,collocations,irregular-verbs}`, API `vocabulary` |
| 3.04-Learner & Owner · Speaking | owner speaking content, `app/(shell)/speaking`, `speaking-view`, `live-speaking*`, API `speaking` |
| 3.05-Learner & Owner · Writing | owner writing content, `app/(shell)/writing`, `writing-view`, API `writing` |
| 3.06-Learner & Owner · Reading | owner reading content, `app/(shell)/reading`, `reading-view`, API `reading` |
| 3.07-Learner & Owner · Listening | owner listening content, `app/(shell)/listening`, `listening-view`, API `listening` |
| 3.08-Learner & Owner · Mock Exam | `owner/content/mock-exam`, `app/(shell)/mock-exam`, `app/(focus)/mock-exam`, `features/mock-exam`, API `mockexam` |
| 3.09-Learner & Owner · IELTS | owner IELTS content, `app/(shell)/ielts`, `app/(focus)/ielts`, API `ielts` |
| 3.10-Learner & Owner · Placement & Question Bank | `owner/content/{placement,question-bank}`, `assessments-view`, `question-bank-view`, `question-editor`, API `assessment` |
| 4.01-Owner · Dashboard | `owner/dashboard`, owner shell/layout/sidebar, `dashboard-view` |
| 4.02-Owner · Analytics | `owner/analytics`, API `analytics` |
| 4.03-Owner · Learners | `owner/learners`, `learners-view`, `learner-detail-view`, API `users` |
| 4.04-Owner · Paywall & Payments | `owner/{paywall,payments}`, API `payments`, `subscriptions` |
| 4.05-Owner · Notifications | `owner/notifications`, `features/notifications`, API `notifications` |
| 4.06-Owner · AI & Team Activity | `owner/ai`, `ai-view`, `team-activity`, API `ai` usage/cost |
| 4.07-Owner · Audit log | `owner/audit`, API `audit` |
| 4.08-Owner · Learner App config | `owner/learner-app` (defaults, feature switches, wallpapers, maintenance) |
| 4.09-Owner · Settings | `owner/settings` (operator language, theme, wallpaper, sessions) |
| 4.10-Owner · Staff & Roles access | `owner/{staff,roles}`, API `authz`, `owner/staff.go`, `owner/visibility.go` |
