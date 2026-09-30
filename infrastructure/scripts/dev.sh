#!/bin/sh
# Run the whole local stack in one terminal: API, worker and web, with prefixed logs.
#
# Why this exists: three terminals (make api / make web / make worker) is three things to
# forget, and on a laptop the machine going to sleep takes all of them down with it. This
# script checks what it depends on, applies pending migrations, starts all three and keeps
# macOS awake (caffeinate) for as long as it runs. Ctrl+C stops everything it started.
#
# Usage: make dev            (or: infrastructure/scripts/dev.sh)
#        NO_WORKER=1 make dev  to skip the background worker

set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

if [ ! -f .env ]; then
  echo "dev: .env not found — run 'make setup' first" >&2
  exit 1
fi

# The one config file; read the two addresses we check below without exporting the rest.
env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/[[:space:]]*#.*$//' -e 's/^"//' -e 's/"$//'; }
DATABASE_URL=$(env_value DATABASE_URL)
REDIS_URL=$(env_value REDIS_URL)

echo "dev: checking PostgreSQL…"
if ! pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
  echo "dev: PostgreSQL is not reachable at DATABASE_URL — start it (brew services start postgresql, or make infra)" >&2
  exit 1
fi
echo "dev: checking Redis…"
if command -v redis-cli >/dev/null 2>&1 && ! redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
  echo "dev: Redis is not reachable at REDIS_URL — start it (brew services start redis, or make infra)" >&2
  exit 1
fi

for port in 8000 3001; do
  if lsof -iTCP:$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "dev: port $port is already in use — stop whatever is running there first (lsof -iTCP:$port)" >&2
    exit 1
  fi
done

echo "dev: applying migrations…"
go run -C apps/api ./cmd/migrate up

PIDS=""
stop() {
  trap - INT TERM EXIT
  echo
  echo "dev: stopping…"
  # Each service runs in its own process group, so go run's compiled child and next's
  # workers go down with it instead of lingering on the port.
  for pid in $PIDS; do kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap stop INT TERM EXIT

# start NAME COMMAND... — run in the background with every line prefixed by the name.
start() {
  name=$1
  shift
  set -m
  ( "$@" 2>&1 | sed -u "s/^/[$name] /" ) &
  PIDS="$PIDS $!"
  set +m
}

start api go run -C apps/api ./cmd/server
if [ -z "${NO_WORKER:-}" ]; then
  start worker go run -C apps/api ./cmd/worker
fi
start web npm run dev -w @engora/web

# Keep the Mac awake while the stack runs; it ends by itself when this script exits.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -w $$ &
fi

echo "dev: API → http://localhost:8000   Web → http://localhost:3001   Owner → http://localhost:3001/owner/login"
echo "dev: press Ctrl+C to stop everything"
wait
