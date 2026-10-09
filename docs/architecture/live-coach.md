# Live speaking coach — load and reliability

The live coach is a WebSocket per conversation (`/api/v1/speaking/live`). A thousand learners
talking at once is a thousand open connections, each turning into three AI calls every
twenty seconds or so. This page is how that is kept from falling over, and how to check.

## What protects it

| Layer | Mechanism | Where |
|---|---|---|
| Admission | Capacity per instance (`LIVE_MAX_SESSIONS`), reserved at admission so a burst cannot overshoot. A full instance answers `503` + `Retry-After: 30` **before** the upgrade. | `internal/practice/live_hub.go` |
| One learner, one conversation | Redis lock `live:session:<user>` (60 s TTL, refreshed every 20 s, token-checked release). A second tab gets `409`. Without Redis the lock is per instance; Redis errors admit rather than block. | `live_hub.go` |
| AI vendors | One semaphore per task (`AI_MAX_CONCURRENT`), queue wait (`AI_QUEUE_WAIT`) then `ErrBusy` → "the coach is busy", per-call timeout (`AI_CALL_TIMEOUT`), one jittered retry on 429/5xx. | `internal/ai/limiter.go`, `gateway.go` |
| A turn | End-to-end deadline (`LIVE_TURN_TIMEOUT`); the follow-up question is generated in parallel with the judging; a failed turn refunds its budget even after a timeout. | `live_speaking.go` |
| Idle connections | Server ping every 25 s, so proxies and load balancers do not close a socket while the learner reads feedback. Writes are serialised. | `live_speaking.go` |
| Deploys | On SIGTERM the hub stops admitting, lets turns in progress finish, saves every conversation and sends `{"type":"reconnect"}` + close `1012`, within `LIVE_DRAIN_TIMEOUT`. `http.Server.Shutdown` alone would cut hijacked connections. | `live_hub.go`, `cmd/server/main.go` |
| Visibility | `GET /api/v1/admin/system/metrics` → `live` (active/capacity, admitted, rejected, turns, p50/p95/p99 turn latency) and `ai_in_flight` per task. | `internal/app/router.go` |

## Load test

`cmd/live-loadtest` drives the real protocol (token in `Sec-WebSocket-Protocol`, a WAV frame
per turn, `turn_end`) against a running API. Use the mock provider with a vendor-like latency:

```bash
cd apps/api
AI_PROVIDER=mock MOCK_AI_LATENCY=800ms DATABASE_MAX_CONNS=30 go run ./cmd/server
go run ./cmd/live-loadtest setup -users 1000
go run ./cmd/live-loadtest run -users 1000 -turns 3 -ramp 30s
go run ./cmd/live-loadtest teardown        # users, subscriptions and their audio files
```

### Results — 2026-10-09, one API instance on an M-series Mac, local Postgres + Redis

| Scenario | Connected | Turns | Dropped | Turn latency p50 / p99 |
|---|---|---|---|---|
| 1000 learners over 30 s, 2 s think | 1000 / 1000 | 3000 / 3000 | 0 | 1.67 s / 1.97 s |
| 1000 learners in 1 s, no think (worst case) | 1000 / 1000 | 3000 / 3000 | 0 | 3.93 s / 4.34 s — queued at the AI cap, no errors |
| Capacity 500, 1000 arrive | 500, 500 refused `503` | 1000 / 1000 | 0 | 1.76 s / 2.23 s for those admitted |
| SIGTERM mid-conversation, 300 learners | 300 | 600 done, 0 turn errors | 0 | 287 told to reconnect, 13 got their summary |

The mock answers in ~0.8 s per call, so a turn's floor is ~1.6 s (transcribe, then judge and
reply in parallel). The infrastructure adds roughly 70 ms on top.

## What this does not cover yet

- Real vendor limits. Set `AI_MAX_CONCURRENT` to the provider's concurrency (Azure Speech
  defaults to 100 concurrent streams per resource; request more, or spread across resources)
  and re-run against a staging key before launch.
- Several instances behind a load balancer: needs sticky WebSocket routing (or none — the
  Redis lock already spans instances) and `LIVE_MAX_SESSIONS` sized per instance.
- Streaming speech (partial transcripts, barge-in) and spoken replies with visemes — the next
  stage, on the same admission and limiter.
