#!/bin/sh
# pre-push: notify GitPulse once the commits actually land on the remote.
#
# Install with: make gitpulse-hook
#
# Git has no post-push hook, so this starts a background watcher instead of sending
# straight away. The watcher polls the remote until it reports the pushed SHA and only
# then notifies, so a rejected push produces no Telegram message.
#
# The hook always exits 0: a notification problem must never block a push.

set -u

REPO_ROOT=$(git rev-parse --show-toplevel)
NOTIFY="$REPO_ROOT/infrastructure/scripts/gitpulse-notify.sh"
[ -x "$NOTIFY" ] || exit 0

REMOTE_NAME="${1:-origin}"

while read -r _local_ref local_sha remote_ref _remote_sha; do
  # Skip empty SHAs and all-zero SHAs (branch deletions): nothing to announce.
  [ -n "$local_sha" ] || continue
  [ -n "$remote_ref" ] || continue
  case "$local_sha" in
    *[!0]*) ;;
    *) continue ;;
  esac

  (
    i=0
    while [ "$i" -lt 30 ]; do
      sleep 1
      actual=$(git ls-remote "$REMOTE_NAME" "$remote_ref" 2>/dev/null | awk '{print $1}')
      if [ "$actual" = "$local_sha" ]; then
        "$NOTIFY" "$local_sha" "${remote_ref#refs/heads/}" || true
        exit 0
      fi
      i=$((i + 1))
    done
  ) >/dev/null 2>&1 &
done

exit 0
