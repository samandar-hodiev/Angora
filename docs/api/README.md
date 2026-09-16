# Engora API

Base URL (local): `http://localhost:8000`

All business endpoints are under **`/api/v1`**. The same API serves web, iOS and Android.

## Conventions

### Envelope

```json
{ "success": true, "data": { }, "meta": { "page": 1, "page_size": 20, "total": 42 } }
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": { "fields": { "email": "must be a valid email address" } },
    "request_id": "8b0c…"
  }
}
```

Clients branch on `error.code` (stable), never on `message`.

| Code | HTTP |
| --- | --- |
| `VALIDATION_ERROR` | 422 |
| `BAD_REQUEST` | 400 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `ENTITLEMENT_REQUIRED` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` | 409 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 |
| `USAGE_LIMIT_REACHED` | 429 |
| `RATE_LIMITED` | 429 (+ `Retry-After`) |
| `INTERNAL_ERROR` | 500 |
| `NOT_IMPLEMENTED` | 501 |
| `SERVICE_UNAVAILABLE` | 503 |

### Headers

| Header | Direction | Purpose |
| --- | --- | --- |
| `Authorization: Bearer <access_token>` | request | Authentication |
| `X-Client-Platform: web \| ios \| android` | request | Session metadata only; never changes behaviour |
| `X-Request-ID` | both | Tracing; send your own (8–64 chars `[A-Za-z0-9._-]`) or receive a generated one |
| `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` | response | Rate limiting |

### Pagination

`?page=1&page_size=20` (max 100) → `meta.page`, `meta.page_size`, `meta.total`.

### Versioning policy

- `/api/v1` is additive-only once mobile apps ship: new fields and endpoints are fine; removing or
  renaming fields, changing types or error codes is not.
- Breaking changes go to `/api/v2` — new handlers/DTOs over the same services — and v1 stays until
  old app versions are retired.
- Clients must ignore unknown fields.

## Endpoints

### Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health/live` | – | Process liveness |
| GET | `/health` | – | Readiness: PostgreSQL + Redis (503 when degraded) |
| GET | `/api/v1/health` | – | Same as `/health` through the versioned base |

### Auth

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | `{ email, password (8–128), display_name, timezone? }` | 201 `Session` |
| POST | `/api/v1/auth/login` | `{ email, password }` | 200 `Session` |
| POST | `/api/v1/auth/refresh` | `{ refresh_token }` | 200 `Session` (rotated refresh token) |
| POST | `/api/v1/auth/logout` | `{ refresh_token }` | 204 |
| POST | `/api/v1/auth/google` | `{ id_token, timezone? }` | 200 `Session` with `is_new_user` |

**Google sign-in.** Web (Google Identity Services) and iOS/Android (native Google Sign-In)
all send the Google **ID token** here. The API verifies the signature against Google's
published keys, the issuer, the audience (must be one of `GOOGLE_CLIENT_IDS`), expiry and
`email_verified`. It then signs in the linked account, links Google to an existing account
with the same email, or creates a new password-less account (`is_new_user: true` → start
onboarding). Without `GOOGLE_CLIENT_IDS` the endpoint returns `501 NOT_IMPLEMENTED`.
Identities live in `user_identities (provider, provider_subject)`; phone sign-in (SMS OTP)
will be added as another provider.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/v1/auth/email/start` | `{ email }` | 200 `{ email, code_length, expires_at, resend_available_at }`; 409 `reason: email_registered` |
| POST | `/api/v1/auth/email/resend` | `{ email }` | 200 challenge; 429 `reason: resend_cooldown \| resend_limit`, `retry_after_seconds` |
| POST | `/api/v1/auth/email/verify` | `{ email, code, timezone? }` | 201 `Session` (`is_new_user: true`); 422 `reason: code_invalid \| code_expired`; 429 `attempts_exceeded` |
| GET | `/api/v1/auth/password/status` | — | `{ has_password, auth_provider }` |
| POST | `/api/v1/auth/password/set` | `{ password }` (8+ chars, letter + number) | 204; 409 `password_exists` |

### New-learner journey

See [docs/architecture/learner-journey.md](../architecture/learner-journey.md) for the flow.

| Method | Path | Notes |
|---|---|---|
| PUT | `/api/v1/profile/setup` | `{ first_name, last_name?, phone_country?, phone_number? (E.164) }` |
| POST / DELETE | `/api/v1/profile/avatar` | multipart `file` (JPG/PNG/WebP ≤ 5 MB, content-sniffed) |
| GET | `/api/v1/avatars/*key` | public, immutable |
| POST / DELETE | `/api/v1/profile/wallpaper` | multipart `file` (JPG/PNG/WebP ≤ 8 MB, content-sniffed); background for the app's main area |
| GET | `/api/v1/wallpapers/*key` | public, immutable |
| GET | `/api/v1/onboarding` | full state: `step`, `profile_completed`, goals, daily minutes, levels, `options` |
| POST | `/api/v1/onboarding/start` | welcome → goals (requires completed profile) |
| PUT | `/api/v1/onboarding/goals` | `{ goals: [...] }` from `options.goals` |
| PUT | `/api/v1/onboarding/daily-time` | `{ minutes }` from `options.daily_minutes` |
| PUT | `/api/v1/onboarding/level` | `{ level }` self-reported → plan |
| POST | `/api/v1/onboarding/placement` | "Find my level" |
| PUT | `/api/v1/onboarding/step` | `{ step }` back navigation / intro → start level |
| PUT | `/api/v1/onboarding/placement/start-level` | `{ level }` creates the placement test |
| POST | `/api/v1/onboarding/placement/abandon` | leave the test, back to level choice |
| POST | `/api/v1/onboarding/results-viewed` · `/plan` · `/complete` | results → plan → completed |
| GET | `/api/v1/levels/me` | `self_reported`, `placement_start`, `assessed`, `current_estimated`, `history` |
| GET | `/api/v1/assessments/config` | active section times, item counts, limits |
| GET / POST | `/api/v1/assessments` | history / start a retake `{ start_level }` |
| GET | `/api/v1/assessments/:id` | status, sections (status, limits, deadlines), `server_time` |
| GET | `/api/v1/assessments/:id/sections/:skill` | stimuli, items (no answer keys), saved answers, attempts |
| POST | `/api/v1/assessments/:id/sections/:skill/start` | sets the server deadline |
| PUT | `/api/v1/assessments/:id/sections/:skill/answers/:item_id` | `{ response: { option_id } \| { text }, time_spent_ms }` |
| POST | `/api/v1/assessments/:id/sections/speaking/recordings` | multipart `item_id`, `duration_ms`, `file` |
| POST | `/api/v1/assessments/:id/sections/:skill/submit` · `/retry` | idempotent submit; retry failed evaluation |
| GET | `/api/v1/assessments/:id/stimuli/:stimulus_id/audio` | listening clip (after the section starts) |
| POST | `/api/v1/assessments/:id/abandon` | |
| GET | `/api/v1/assessments/:id/result` | overall estimate, four skills, strengths, focus areas, summary |
| GET | `/api/v1/learning-plan` | active plan with structured `items` |
| POST | `/api/v1/analytics/events` | `{ events: [{ name, properties?, occurred_at?, anonymous_id? }] }` (client events only) |

Rate limited per IP (`RATE_LIMIT_AUTH_PER_MINUTE`).

```json
{
  "access_token": "eyJ…",
  "access_token_expires_at": "2026-09-14T13:15:00Z",
  "refresh_token": "d3Jv…",
  "refresh_token_expires_at": "2026-10-14T13:00:00Z",
  "token_type": "Bearer",
  "user": { "id": "…", "email": "learner@example.com", "role": "USER", "status": "active", "…": "…" }
}
```

Refresh tokens are single-use. Reusing an old one revokes the whole session; call refresh from one
place at a time.

### Users & profile

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/users/me` | user | Current account |
| GET | `/api/v1/profile` | `profile:manage_own` | Learner profile |
| PATCH | `/api/v1/profile` | `profile:manage_own` | Partial update: `display_name`, `native_language`, `timezone`, `current_level`, `target_level`, `learning_goals`, `daily_goal_minutes`, `preferences` (merged), `complete_onboarding` |
| GET | `/api/v1/admin/users` | `users:read` (ADMIN) | Paginated accounts |

### Learning catalogue

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/learning/skills` | – | Active skills |
| GET | `/api/v1/learning/levels` | – | CEFR levels |
| GET | `/api/v1/learning/content` | `content:read` | Published content; filters `type`, `skill`, `level`, `exam`, `tag`; paginated |
| GET | `/api/v1/learning/content/:id` | `content:read` | Content item with `body` and `schema_version` |

### Subscriptions

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/subscriptions/plans` | – | Public plans with entitlements |
| GET | `/api/v1/subscriptions/me` | user | `{ subscription, entitlements }` |

```json
{
  "plan_code": "free", "plan_name": "Free", "status": "free",
  "features": ["listening.practice", "reading.practice", "speaking.practice", "writing.practice"],
  "limits": {
    "speaking.evaluations": { "label": "AI speaking evaluations", "limit": 3, "used": 1,
      "remaining": 2, "period": "day", "resets_at": "2026-09-15T00:00:00Z" }
  }
}
```

### Password reset

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/password/forgot` | `{ email }` | 202 — always, whether or not the account exists |
| POST | `/api/v1/auth/password/reset` | `{ token, password }` | 204; single-use token (1 h); signs out every session |

### Learner read models

All require `learning:practice` (any learner).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/progress` | Levels, daily goal, overall score, streak, per-skill score/xp/sessions |
| GET | `/api/v1/history` | Speaking, writing, reading and listening activity, newest first (paginated) |
| GET | `/api/v1/mistakes` | Mistakes, optional `group` (grammar / vocabulary / pronunciation), paginated |
| GET | `/api/v1/mistakes/summary` | Counts by group, repeated patterns, active weaknesses |
| GET | `/api/v1/vocabulary/deck` | Deck summary and cards with server-computed `mastery`, ordered by due date |
| GET | `/api/v1/grammar/topics` | Published topics with the learner's mastery |
| GET | `/api/v1/recommendations` | Pending recommendations with linked content and `source` |
| GET | `/api/v1/learning-plan` | `{ plan }` — active plan or `null` |

### Admin

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/overview` | `users:read` | Users, users per plan, MRR, 30-day AI cost, content by status |
| GET | `/api/v1/admin/ai-usage?days=30` | `ai_usage:read` | Totals, by task, by provider/model (with avg latency), daily cost |
| GET | `/api/v1/admin/content` | `content:manage` | All content in every status; filters `type`, `skill`, `level`, `status` |

### Jobs

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/jobs/:id` | owner | `{ id, type, status: queued\|running\|retrying\|succeeded\|failed, attempts, error_code?, result?, updated_at }` |

### Admin / system

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/system/metrics` | `system:read` (ADMIN) | Request counters, latency histogram |

## Example session

```bash
curl -s localhost:8000/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"learner@example.com","password":"correct-horse-battery","display_name":"Learner"}'

TOKEN=…   # data.access_token
curl -s localhost:8000/api/v1/subscriptions/me -H "Authorization: Bearer $TOKEN"
```
