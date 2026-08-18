#!/bin/bash
# Auto-pull latest main into the staging clone every 2 minutes (via cron).
# Lives on the VPS at /home/admin/Store-staging/auto-pull.sh — copy this file
# there after editing it here, cron does not read from the git checkout.
# Only restarts the staging pm2 process if backend/ actually changed.
set -e
cd /home/admin/Store-staging

BEFORE=$(git rev-parse HEAD)
git fetch origin main --quiet
git reset --hard origin/main --quiet
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  echo "$(date -Iseconds) updated $BEFORE -> $AFTER"
  if git diff --name-only "$BEFORE" "$AFTER" | grep -q '^backend/'; then
    cd backend && npm install --omit=dev --quiet 2>&1 | tail -5
    # npm install does NOT regenerate the Prisma client on its own — without this,
    # a schema.prisma change ships but the running server keeps using the stale
    # generated client and 500s on anything touching the new fields/enum values.
    npx prisma generate 2>&1 | tail -5
    pm2 restart shilista-api-staging --update-env
    echo "$(date -Iseconds) restarted shilista-api-staging (backend changed)"
  fi
fi
