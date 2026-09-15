# Engora developer commands. Run `make help` for the list.

API_DIR := apps/api
TEST_DATABASE_URL ?= postgres://localhost:5432/engora_test?sslmode=disable
TEST_REDIS_URL ?= redis://localhost:6379/15

.DEFAULT_GOAL := help
.PHONY: help setup up down infra logs api worker web migrate-up migrate-down migrate-version migrate-create \
        test test-api test-api-integration test-web lint typecheck build gitpulse-hook

## help: list available commands
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'

## setup: install dependencies and create .env with a random JWT secret
setup:
	@test -f .env || (cp .env.example .env && \
		secret=$$(openssl rand -base64 48 | tr -d '\n/+=') && \
		sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$$secret|" .env && rm -f .env.bak && \
		echo "created .env")
	npm install
	cd $(API_DIR) && go mod download

## up: build and start the full stack in docker (postgres, redis, migrate, api, worker, web)
up:
	docker compose up --build

## down: stop the docker stack
down:
	docker compose down

## infra: start only postgres and redis in docker (run api/web locally)
infra:
	docker compose up -d postgres redis

## logs: follow docker logs
logs:
	docker compose logs -f

## api: run the API locally (http://localhost:8000)
api:
	cd $(API_DIR) && go run ./cmd/server

## worker: run the background worker locally
worker:
	cd $(API_DIR) && go run ./cmd/worker

## web: run the web app locally (http://localhost:3001)
web:
	npm run dev -w @engora/web

## migrate-up: apply all pending migrations
migrate-up:
	cd $(API_DIR) && go run ./cmd/migrate up

## migrate-down: roll back the latest migration
migrate-down:
	cd $(API_DIR) && go run ./cmd/migrate down 1

## migrate-version: print the current schema version
migrate-version:
	cd $(API_DIR) && go run ./cmd/migrate version

## migrate-create: create a migration pair, e.g. make migrate-create name=add_placement_tests
migrate-create:
	@test -n "$(name)" || (echo "usage: make migrate-create name=snake_case_name" && exit 1)
	cd $(API_DIR) && go run ./cmd/migrate create $(name)

## seed: load sample learning content (development only)
seed:
	cd $(API_DIR) && go run ./cmd/seed content

## seed-demo: sample content + a demo learner (demo@engora.dev / engora-demo-2026)
seed-demo:
	cd $(API_DIR) && go run ./cmd/seed demo

## promote: make an account ADMIN, e.g. make promote email=you@example.com
promote:
	@test -n "$(email)" || (echo "usage: make promote email=you@example.com" && exit 1)
	cd $(API_DIR) && go run ./cmd/seed promote $(email)

## test: run all unit tests (API + web + packages)
test: test-api test-web

## test-api: run Go unit tests
test-api:
	cd $(API_DIR) && go test ./...

## test-api-integration: run Go tests including PostgreSQL/Redis integration (uses a disposable test DB)
## WARNING: the migration test migrates the database down and up, erasing its data. Never point
## TEST_DATABASE_URL at your development database. Seed the test DB first (DATABASE_URL=... seed content)
## so the placement flow test runs. Packages run one at a time (-p 1) because they share the database.
test-api-integration:
	cd $(API_DIR) && TEST_DATABASE_URL="$(TEST_DATABASE_URL)" TEST_REDIS_URL="$(TEST_REDIS_URL)" go test -p 1 -count=1 ./...

## test-web: run web and package tests
test-web:
	npm test

## lint: go vet + eslint
lint:
	cd $(API_DIR) && go vet ./...
	npm run lint

## typecheck: TypeScript checks for all workspaces
typecheck:
	npm run typecheck

## build: compile API binaries and build the web app
build:
	cd $(API_DIR) && go build -o bin/ ./cmd/...
	npm run build:web

## gitpulse-hook: install the pre-push hook that notifies GitPulse (Telegram) after a push
gitpulse-hook:
	@cp infrastructure/scripts/pre-push-hook.sh .git/hooks/pre-push
	@chmod +x .git/hooks/pre-push infrastructure/scripts/gitpulse-notify.sh
	@echo "pre-push hook installed; a successful push now notifies GitPulse"
