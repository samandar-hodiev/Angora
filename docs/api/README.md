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
