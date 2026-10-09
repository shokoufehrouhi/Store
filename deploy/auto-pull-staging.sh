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

# git reset --hard only tracks backend/public/uploads/.gitkeep, not the
# directory itself — every reset re-materializes uploads/ as a plain empty
# dir, silently discarding the symlink to production's uploads dir. Staging
# shares production's DB (so a receipt/photo row can be read from either
# side) but NOT its disk by default; without this, any file uploaded via
# staging's own API physically lands in staging's local uploads/ and 404s
# (or ENOENTs — see backend/controllers/adminController.js's approve/reject
# payment handlers) the moment production tries to read the same row.
#
# That re-link ran on EVERY pull (a few old uploads are tracked in git, so
# each reset turned the symlink back into a plain dir), and a script writing
# photos at that moment made rm fail, set -e then skipped the ln, and the
# next pull rm -rf'd everything written there since — 468 photos lost on
# 2026-10-08. So the clone is sparse now (uploads/ excluded: reset leaves
# the symlink alone), and if a plain dir ever does show up, it's swapped
# out in one rename and its files are moved over, never just deleted.
if [ "$(git config core.sparseCheckout)" != "true" ]; then
  git sparse-checkout init --no-cone
  printf '/*\n!/backend/public/uploads/\n' > .git/info/sparse-checkout
  git sparse-checkout reapply 2>/dev/null || true
fi
if [ ! -L backend/public/uploads ]; then
  STRAY="backend/public/uploads.stray.$$"
  mv backend/public/uploads "$STRAY" 2>/dev/null || true
  # uploads/ was the only tracked thing in public/, so the sparse checkout
  # removes public/ itself.
  mkdir -p backend/public
  ln -s /home/admin/Store/backend/public/uploads backend/public/uploads
  if [ -d "$STRAY" ]; then
    cp -an "$STRAY"/. /home/admin/Store/backend/public/uploads/ || true
    rm -rf "$STRAY"
  fi
  echo "$(date -Iseconds) re-linked backend/public/uploads -> production's uploads dir"
fi

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
