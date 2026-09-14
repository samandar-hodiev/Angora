#!/bin/sh
# Tell GitPulse (the local GitHub → Telegram notifier) about a commit that has just landed
# on the remote.
#
# Why this exists: the GitHub webhook reaches GitPulse through ngrok, whose free URL changes
# on restart. This script is the local path: it builds the payload GitHub would send, signs
# it with the same webhook secret and posts it straight to GitPulse. Both paths can be
# active; GitPulse ignores the duplicate.
#
# The secret is read from GitPulse's own .env and is never printed or logged.
#
# Usage: infrastructure/scripts/gitpulse-notify.sh <commit-sha> [branch]

set -eu

SHA="${1:?usage: gitpulse-notify.sh <commit-sha> [branch]}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD)}"

GITPULSE_DIR="${GITPULSE_DIR:-$HOME/Desktop/gitpulse/gitpulse}"
GITPULSE_URL="${GITPULSE_URL:-http://localhost:8080/webhook/github}"
GITPULSE_HEALTH="${GITPULSE_HEALTH:-http://localhost:8080/health}"
ENV_FILE="$GITPULSE_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "gitpulse-notify: $ENV_FILE topilmadi, xabar yuborilmadi" >&2
  exit 0
fi

SECRET=$(grep '^GITHUB_WEBHOOK_SECRET=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  echo "gitpulse-notify: GITHUB_WEBHOOK_SECRET bo'sh, xabar yuborilmadi" >&2
  exit 0
fi

if ! curl -fsS -m 3 -o /dev/null "$GITPULSE_HEALTH" 2>/dev/null; then
  echo "gitpulse-notify: GitPulse javob bermayapti, xabar yuborilmadi" >&2
  exit 0
fi

REPO_URL=$(git config --get remote.origin.url | sed -e 's#\.git$##' -e 's#^git@github.com:#https://github.com/#')
REPO_NAME=$(basename "$REPO_URL")

PAYLOAD=$(
  SHA="$SHA" REPO_URL="$REPO_URL" REPO_NAME="$REPO_NAME" BRANCH="$BRANCH" \
  python3 - <<'PY'
import json, os, subprocess

sha = os.environ["SHA"]

def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True).stdout.strip()

added, modified, removed = [], [], []
for line in git("show", "--name-status", "--pretty=", sha).splitlines():
    parts = line.split("\t")
    if len(parts) < 2:
        continue
    status, path = parts[0][:1], parts[-1]
    {"A": added, "M": modified, "D": removed}.get(status, modified).append(path)

payload = {
    "ref": f"refs/heads/{os.environ['BRANCH']}",
    "repository": {"name": os.environ["REPO_NAME"], "html_url": os.environ["REPO_URL"]},
    "head_commit": {
        "id": sha,
        "message": git("log", "-1", "--pretty=%B", sha),
        "timestamp": git("log", "-1", "--date=iso-strict", "--pretty=%ad", sha),
        "url": f"{os.environ['REPO_URL']}/commit/{sha}",
        "author": {
            "name": git("log", "-1", "--pretty=%an", sha),
            "email": git("log", "-1", "--pretty=%ae", sha),
        },
        "added": added,
        "modified": modified,
        "removed": removed,
    },
}
print(json.dumps(payload))
PY
)

SIG="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')"

RESPONSE=$(printf '%s' "$PAYLOAD" | curl -s -m 15 -w '\n%{http_code}' \
  -X POST "$GITPULSE_URL" \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: push' \
  -H "X-Hub-Signature-256: $SIG" \
  --data-binary @-)
CODE=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')
SHORT=$(printf '%s' "$SHA" | cut -c1-7)

case "$CODE:$BODY" in
  200:Duplicate*) echo "gitpulse-notify: $SHORT allaqachon Telegramga yuborilgan" ;;
  200:*)          echo "gitpulse-notify: Telegramga yuborildi ($SHORT)" ;;
  *)              echo "gitpulse-notify: GitPulse $CODE qaytardi: $BODY" >&2 ;;
esac

# Keep a local trace, since the pre-push hook runs this in the background.
LOG_DIR="$(git rev-parse --git-dir)/gitpulse"
mkdir -p "$LOG_DIR" && printf '%s %s %s %s\n' "$(date '+%F %T')" "$SHORT" "$CODE" "$BODY" >> "$LOG_DIR/notify.log"
