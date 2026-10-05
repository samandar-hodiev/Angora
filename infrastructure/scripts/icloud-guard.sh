#!/bin/sh
# Keep generated folders out of iCloud Drive.
#
# Why this exists: with "Desktop & Documents" in iCloud, macOS offloads files it thinks are
# unused. node_modules and .next are tens of thousands of such files, and once they are
# offloaded the dev server waits on iCloud for each one — pages load forever, then fail with
# "Operation timed out (os error 60)". iCloud leaves anything named *.nosync alone, so each
# folder lives in "<name>.nosync" with a symlink in its place. npm replaces the symlink with a
# real folder on install; this moves it back. It does nothing outside iCloud Drive.
#
# Usage: infrastructure/scripts/icloud-guard.sh   (make dev runs it)

set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

case "$ROOT" in
  "$HOME/Desktop"/* | "$HOME/Documents"/* | "$HOME/Library/Mobile Documents"/*) ;;
  *) exit 0 ;;
esac

for dir in node_modules apps/web/.next; do
  target="$dir.nosync"
  if [ -d "$dir" ] && [ ! -L "$dir" ]; then
    echo "icloud-guard: moving $dir out of iCloud sync"
    rm -rf "$target"
    mv "$dir" "$target"
  fi
  mkdir -p "$target"
  [ -L "$dir" ] || ln -s "$(basename "$target")" "$dir"
done

# Source files iCloud has offloaded are fetched back in the background — a download can be
# slow, and the dev server should not wait for files it may never read.
offloaded=$(find . -path ./.git -prune -o -name '*.nosync' -prune -o -flags +dataless -type f -print 2>/dev/null | wc -l | tr -d ' ')
if [ "$offloaded" -gt 0 ]; then
  echo "icloud-guard: fetching $offloaded offloaded file(s) back from iCloud in the background"
  (find . -path ./.git -prune -o -name '*.nosync' -prune -o -flags +dataless -type f -print0 2>/dev/null |
    xargs -0 -n 20 -P 8 cat >/dev/null 2>&1 &) || true
fi
if [ -n "$(find node_modules.nosync -flags +dataless -print -quit 2>/dev/null)" ]; then
  echo "icloud-guard: node_modules was offloaded by iCloud — reinstalling it from the npm cache"
  rm -rf node_modules.nosync && mkdir node_modules.nosync
  rm -f node_modules && npm ci --prefer-offline --no-audit --no-fund
  mv node_modules/* node_modules/.[!.]* node_modules.nosync/ 2>/dev/null || true
  rm -rf node_modules && ln -s node_modules.nosync node_modules
fi
