#!/usr/bin/env bash
# Lance l'API (dist) et le web (next start), exécute Playwright, puis arrête les serveurs.
# Prérequis : pnpm build, base migrée et alimentée (pnpm db:migrate && pnpm db:seed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/apps/api"
EMAIL_DRIVER=memory node --env-file=../../.env dist/main.js > /tmp/tm-api.log 2>&1 &
API=$!
cd "$ROOT/apps/web"
node node_modules/next/dist/bin/next start -p 3000 > /tmp/tm-web.log 2>&1 &
WEB=$!
trap 'kill $API $WEB 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
  if curl -sf http://localhost:4000/health >/dev/null && curl -sf -o /dev/null http://localhost:3000/login; then break; fi
  sleep 1
done
npx playwright test "$@"
