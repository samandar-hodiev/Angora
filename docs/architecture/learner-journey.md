# New-learner journey: authentication → profile → onboarding → level → placement → plan

The journey is owned by the Go API and stored in PostgreSQL. The web app is its first client;
the iOS and Android apps call exactly the same endpoints and render their own screens.

```
/register ─┬─ Continue with Google ─────────────────────────────┐
           └─ Continue with email → /register/email → /verify-email (6-digit code, server-checked)
                                                                   │
                                           /setup-profile  (name, photo, phone, password)
                                                                   │
                                   /onboarding (welcome → goals → daily time)
                                                                   │
                                   /level ── "I know my level" → personalised plan → /app/dashboard
                                      └──── "Find my level" → intro → closest level
                                                                   │
                           /placement-test/:id  reading → listening → writing → speaking
                                                                   │  (AI evaluation job)
                           /assessment-results/:id  level · four skills · strengths · focus · plan
                                                                   │
                                                          /app/dashboard
```

Existing learners who finished setup sign in and land on the dashboard. Anyone who stopped
part-way is sent back to the exact step by the journey guard (`features/onboarding/routing.ts`),
because the server knows where they are.

## Separation of concerns

| Stage | Question it answers | Data |
|---|---|---|
| Authentication | Who are you? | `users` (email, `auth_provider`, verification), `user_identities`, `email_verification_codes`, refresh tokens |
| Account profile | What is your account? | `profiles.first_name/last_name/avatar_storage_key/phone_*`, `profile_completed_at` |
| Onboarding | What do you want to achieve? | `profiles.learning_goals`, `profiles.daily_goal_minutes`, `onboarding_progress` |
| Level | How good is your English (self-reported)? | `user_levels` (`self_reported`) |
| Placement | What is your measured level? | `assessments`, `assessment_*`, `user_levels` (`placement_start`, `assessed`, `estimated`) |
| Plan | What should you practise? | `learning_plans`, `learning_plan_items` |

## Authentication

- **Email:** `POST /auth/email/start` sends a 6-digit code (stored only as a hash, 10-minute expiry,
  5 wrong attempts, 45 s resend cooldown, 5 codes/hour). `POST /auth/email/verify` creates the
  account with a verified email and returns a session (`is_new_user: true`). An email that already
  has an account returns `409` with `reason: email_registered` (sign-up must say so; password reset
  never reveals whether an account exists).
- **Google:** `POST /auth/google` with a Google ID token; new accounts get `auth_provider = google`.
- **Password:** not required to create an account. Accounts created with an email code set one during
  profile setup (`POST /auth/password/set`, `GET /auth/password/status`) so they can sign in with
  email + password; reset uses single-use, expiring tokens.
- The architecture accepts future providers (Apple, phone OTP) as new `user_identities.provider`
  values and `users.auth_provider` values.

## Onboarding state machine

`onboarding_progress.step`:
`NOT_STARTED → WELCOME → GOAL_SELECTION → DAILY_TIME → LEVEL_SELECTION →`
`PLACEMENT_INTRO → PLACEMENT_START_LEVEL → PLACEMENT_READING → PLACEMENT_LISTENING →`
`PLACEMENT_WRITING → PLACEMENT_SPEAKING → PLACEMENT_PROCESSING → PLACEMENT_RESULTS →`
`PERSONALIZED_PLAN → COMPLETED`

Onboarding cannot start before the profile is complete. Placement steps are advanced by the
assessment module, so a closed browser resumes in the right section. A placement test retaken later
from the dashboard (`source = profile`) never changes onboarding.

## Levels

Four kinds of statements, never overwritten (`user_levels`):
`self_reported` (the learner's choice), `placement_start` (the level they think they're closest to),
`assessed` (a test result) and `estimated` (Engora's current estimate). `profiles.current_level_id`
mirrors the latest estimate for cheap reads. Results are always called *estimated*; nothing claims an
official CEFR certification or IELTS score.

## Placement assessment

- **Configuration** (`assessment_configs`, versioned, snapshotted per assessment): section order, time
  limits (reading 12, listening 12, writing 20, speaking 8 minutes), items per band, listening play
  limit and speaking attempts. Change timing by activating a new config version; no client release.
- **Content** is data: stimuli are `content_items` with `exam = 'placement'` (passages, listening clips
  whose audio lives in object storage), questions/tasks are `assessment_items` with skill, CEFR level,
  difficulty, topic, type, options, answer key, explanation, status and version. Answer keys are never
  sent to clients. Seeded from `apps/api/cmd/seed/placement/content.json`; an admin editor can write
  the same tables later.
- **Selection** (`internal/assessment/selection.go`): a fixed form around the starting level —
  foundation (one level below), core (at) and challenge (one above), e.g. A2 → B1 → B2 — stored when
  the test is created so every refresh and device shows the same test. The item bank supports an
  adaptive engine later.
- **Sections** unlock strictly in order. `deadline_at` is set by the server; overdue sections are
  auto-submitted with the answers saved so far. Answers autosave (`PUT .../answers/:item`), recordings
  upload to object storage (`POST .../recordings`, retake limit, idempotent re-upload). Submitting is
  idempotent.

## Evaluation and scoring

- Reading/listening are marked on the server when the section is submitted.
- Writing: submission → structured AI evaluation (task response, grammar, vocabulary, coherence,
  CEFR estimate, confidence, mistakes; strict JSON schema, validated) → measured word count.
- Speaking: audio → speech-to-text → transcript → measured speech time, words per minute, pauses →
  pronunciation analysis (no provider yet: recorded as unavailable, weights renormalised, confidence
  lowered) → structured AI linguistic evaluation.
- Evaluation runs as a background job (`assessment.evaluate_section`). Each AI result is stored in
  `ai_analyses` with model/prompt/rubric/schema versions before scoring, so retries never re-bill or
  change a result. Failures keep the submission and offer a retry.
- `internal/assessment/scoring` (deterministic, versioned `placement-scoring.v1`) turns responses into
  per-skill scores and CEFR estimates (difficulty-weighted accuracy, per-level pass/partial rules,
  length caps, confidence) and combines them into the overall estimate: confidence-weighted on the
  CEFR scale, capped at 1.5 levels above the weakest skill, rounded down — not an average of
  percentages. It also produces strengths, focus areas and a coach summary from structured data only.
- Completion writes `assessment_results`, `assessment_skill_results`, `user_levels`, `skill_progress`,
  `weaknesses` (from focus criteria and mistakes) and generates the plan.

With `AI_PROVIDER=mock` the pipeline runs end to end but writing/speaking scores come from simple text
features and a placeholder transcript: use a real provider for genuine evaluation.

## Personalised plan

`internal/personalization` (rule-based, `plan-rules.v1`) builds today's plan from level, daily
minutes, goals, assessment focus areas and recurring mistakes: weaknesses first, then goals, then
balance; 10–20 minutes → 2 items, 30 → 3, 45–60 → 4. Stored as `learning_plans` + structured
`learning_plan_items` (skill, focus code, activity code, title, minutes, reason, linked content).
The dashboard reads it from `GET /learning-plan`.

## Analytics

`internal/analytics` is provider-neutral (`analytics_events`). The server records state changes
(`email_verification_sent/completed`, `signup_completed`, `onboarding_started/completed`,
`goal_selected`, `daily_time_selected`, `level_selected`, `placement_started`,
`placement_section_started/completed`, `placement_completed/abandoned`, `personalized_plan_created`,
`profile_setup_completed`). Clients may only send UI events (`signup_started`,
`signup_google_clicked`, `signup_email_clicked`, `login_started/completed`,
`forgot_password_started`, `password_reset_completed`, `profile_setup_started`,
`assessment_result_viewed`, `first_learning_session_started`) via `POST /analytics/events`.

## Testing

- Unit: `pkg/cefr`, `internal/assessment/scoring`, `internal/assessment` (selection, config),
  `internal/personalization`, `internal/auth` (email codes, passwords), web `routing`, `otp-input`,
  `phone`.
- Integration (`TestPlacementFlowPostgres`): the whole onboarding placement journey against
  PostgreSQL, including timer expiry, idempotency, retake limits and abandoning. Use a disposable
  database — the migration test migrates it down and up:
  `createdb engora_test && DATABASE_URL=…/engora_test go run ./cmd/migrate up && DATABASE_URL=…/engora_test go run ./cmd/seed content`
  then `make test-api-integration TEST_DATABASE_URL=…/engora_test`.
