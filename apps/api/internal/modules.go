// Package internal documents the domain modules of the Engora modular monolith.
//
// Implemented in the foundation phase:
//
//	auth           registration, login, token refresh/rotation, logout, authentication middleware
//	authz          roles → permissions, authorization middleware
//	users          accounts (identity, role, status)
//	profiles       learner profile: levels, goals, daily goal, preferences
//	learning       catalogue: skills, levels, published content items
//	subscriptions  plans, entitlements, usage limits
//	ai             provider abstraction, gateway, usage/cost tracking, versioned results
//	storage        object storage abstraction (local, S3, Cloudflare R2), upload validation
//	jobs           background job queue, worker, job state polling
//	audit          audit trail
//	health         liveness/readiness
//	platform/*     database, cache, middleware, rate limiting, observability
//
// Reserved for later phases (see docs/product/roadmap.md). Each owns the tables named in
// its doc.go and follows the same shape: model + repository + service + handler, routes
// registered from internal/app.
//
//	speaking, writing, reading, listening, vocabulary, grammar, pronunciation,
//	ielts, progress, mistakes, recommendations, payments
//
// Rules: modules talk to each other through small interfaces declared by the consumer
// (see auth.UserStore), never by reaching into another module's tables.
package internal
