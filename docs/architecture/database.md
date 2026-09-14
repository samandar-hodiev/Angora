# Database

PostgreSQL 15+ (docker uses 17) is the single source of truth. Every schema change is a numbered
migration in `apps/api/migrations`, embedded in the API binary and applied with
`go run ./cmd/migrate up` (or the `migrate` service in docker compose). Manual schema changes are
not allowed.

## Conventions

- Primary keys: `UUID DEFAULT gen_random_uuid()` (natural keys only for lookup tables like `roles`, `entitlements`).
- Timestamps: `created_at`, `updated_at` as `TIMESTAMPTZ`; `updated_at` is maintained by the
  shared `set_updated_at()` trigger. Soft deletion only where accounts need it (`users.deleted_at`).
- Constrained vocabularies use `CHECK` constraints; open-ended ones (content `type`, mistake
  `category`) are plain text validated by the owning module.
- Foreign keys everywhere; `ON DELETE CASCADE` for user-owned data, `SET NULL` for references
  that should survive deletion (e.g. a deleted content item does not delete learner history).
- Indexes follow access paths: `(user_id, created_at DESC)` for histories, partial indexes for
  "live" rows (one active subscription, one active learning plan, unread notifications).
- Flexible payloads use `JSONB` with an explicit `schema_version`.

## Migrations

| # | Name | Contents |
| --- | --- | --- |
| 1 | identity | `roles`, `users`, `refresh_tokens`, `audit_logs`, `set_updated_at()` |
| 2 | reference_and_profiles | `levels` (CEFR A1–C2 seeded), `skills` (7 seeded), `profiles` |
| 3 | content | `topics`, `lessons`, `content_items`, `grammar_topics`, `vocabulary` |
| 4 | subscriptions | `subscription_plans`, `entitlements`, `plan_entitlements`, `subscriptions`, `usage_counters` + Free / Pro / IELTS Pro seed |
| 5 | ai | `ai_requests`, `ai_usage`, `ai_analyses` |
| 6 | practice | `audio_files`, `transcripts`, `speaking_sessions`, `writing_submissions`, `reading_attempts`, `listening_attempts` |
| 7 | progress_and_personalization | `user_vocabulary`, `vocabulary_reviews`, `user_grammar_progress`, `mistakes`, `weaknesses`, `skill_progress`, `learning_plans`, `recommendations` |
| 8 | engagement | `notifications`, `streaks`, `achievements`, `user_achievements` |

Every migration has a working `down`; the integration test runs up → down → up.

```bash
make migrate-up
make migrate-down                        # one step
make migrate-create name=add_placement_tests
```

## Entity map

```text
users ─┬─ profiles (1:1) ── levels (current / target)
       ├─ refresh_tokens (session families)
       ├─ subscriptions ── subscription_plans ── plan_entitlements ── entitlements
       ├─ usage_counters (per entitlement per period)
       ├─ speaking_sessions ─┬─ audio_files ── transcripts
       │                     └─ ai_analyses ── ai_requests
       ├─ writing_submissions ── ai_analyses
       ├─ reading_attempts / listening_attempts ── content_items
       ├─ mistakes ──▶ weaknesses ──▶ recommendations ── learning_plans
       ├─ skill_progress ── skills
       ├─ user_vocabulary / vocabulary_reviews ── vocabulary
       ├─ user_grammar_progress ── grammar_topics
       ├─ notifications, streaks, user_achievements ── achievements
       └─ audit_logs (actor)

content_items ── skills, levels, topics, lessons   (type, exam, difficulty, tags, status, body JSONB)
```

## User model and cross-device sync

- Account (`users`) is separate from the learner profile (`profiles`): identity and security
  change rarely; learning preferences change often.
- CEFR level, target level, goals, daily goal and preferences live in `profiles`; skill-level
  progress lives in `skill_progress`; history is the practice tables themselves.
- Nothing about learning state is stored only on a device. `updated_at` on every mutable row is
  the basis for incremental sync (`?updated_since=`) and conflict detection when mobile adds
  offline support.
- Practice rows record `client_platform` for analytics only.

## Content model

`content_items.type` identifies the content (speaking_topic, writing_task, reading_passage,
listening_exercise, grammar_exercise, exam_question, mock_exam). Shared metadata (skill, level,
topic, exam, difficulty, tags, status) is relational and indexed; the type-specific body is JSONB
validated by the owning module against `schema_version`. Publishing workflow:
`draft → review → published → archived`. Only `published` content is served to learners.

## Subscriptions model

- A plan is a set of `plan_entitlements` rows. Feature entitlements are presence/absence; limit
  entitlements have `limit_value` (NULL = unlimited) and `limit_period`.
- Users without a live subscription fall back to the plan with `is_default = true`.
- `usage_counters` are incremented atomically with the limit check in the same statement.
- Monthly/annual/trial/promotional variants are additional plan rows or subscription `provider`
  values (`manual`, `promo`, `stripe`, `app_store`, `google_play`).

## AI data

- `ai_requests`: one row per provider call — task, provider, model, tokens, audio seconds,
  estimated cost, latency, status, error code, prompt version. No prompts or user content.
- `ai_usage`: daily roll-up per user/provider/model/task (`NULLS NOT DISTINCT` unique key).
- `ai_analyses`: structured JSON results with `schema_version`, `model_version`,
  `prompt_version`, `rubric_version`, `analysis_version`.

## Media

Audio bytes are never stored in PostgreSQL. `audio_files` stores `storage_provider`,
`storage_key`, `mime_type`, `size_bytes`, `duration_ms`, `checksum_sha256` and status.
