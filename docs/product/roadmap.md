# Product roadmap

Engora — *Your AI English Coach*. The learning loop every phase strengthens:

```text
Practice → AI analysis → Feedback → Weakness detection → Personalised practice → Progress → Repeat
```

IELTS is one mode of the platform, not the platform.

| Phase | Scope | Builds on |
| --- | --- | --- |
| **1. Foundation** ✅ | Monorepo, Go API, PostgreSQL schema, Redis, auth, RBAC, entitlements, AI gateway, storage, jobs, web shell, docs | – |
| 2. Speaking AI | Speaking sessions, audio upload (presigned), transcription + evaluation jobs, results UI, pronunciation basics | `ai`, `storage`, `jobs`, `speaking_sessions`, `ai_analyses` |
| 3. Writing AI | Writing tasks, submissions, evaluation, inline corrections | `ai`, `writing_submissions` |
| 4. Reading + Listening | Passages, audio exercises, objective scoring, TTS for listening | `content_items`, `reading_attempts`, `listening_attempts` |
| 5. Vocabulary + Grammar | Word bank, spaced repetition, grammar topics and exercises | `vocabulary`, `user_vocabulary`, `grammar_topics` |
| 6. Personalisation engine | Mistake extraction, weaknesses, skill progress, learning plans, rule-based recommendations, progress & history UI | `mistakes`, `weaknesses`, `skill_progress`, `recommendations` |
| 7. AI Coach | Context-aware coach using mistakes, goals and progress | `ai.Coach`, recommendations |
| 8. IELTS mode | IELTS modes for all skills, estimated band scoring, mock exams | `ielts`, `content_items.exam`, `ai.IELTSScorer` |
| 9. Payments + Premium | Web checkout, App Store / Google Play, plan management, upgrade flows | `payments.Provider`, `subscriptions` |
| 10. Mobile app | React Native (iOS/Android) on the same API; push notifications, device tokens, offline-friendly sync | `/api/v1`, `packages/types`, `packages/ui` tokens |
| 11. Realtime AI conversation | Low-latency voice conversation sessions | `ai.RealtimeSessionFactory` |
| 12. Community / challenges | Challenges, leaderboards, streak social features | `streaks`, `achievements` |
| 13. B2B | Schools, universities, teachers, business accounts, seat licences | roles (`TEACHER`, `BUSINESS_ADMIN`), plans |

## Next up (Phase 2 checklist)

- [ ] `speaking` module: session create/submit, presigned upload, `audio_files` lifecycle
- [ ] `ai/evaluation`: `SpeakingEvaluator` with versioned prompt and rubric
- [ ] Worker handler `speaking.evaluate` with usage-limit consumption at enqueue time
- [ ] Web: recorder, upload progress, AI processing state, results page
- [ ] Evaluation regression set + script comparing versions
- [ ] Delayed job retries and stale-job reaper
- [ ] Email verification and password reset (auth)
