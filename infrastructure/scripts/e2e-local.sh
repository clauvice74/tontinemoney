#!/usr/bin/env bash
# Lance l'API (dist), le reporting-service extrait (étape 7), l'API Gateway, le Payment Gateway (dist) et le web (next start), exécute
# Playwright, puis arrête les serveurs. Le web appelle l'API Gateway (API_URL, évalué au build) ;
# les webhooks du PSP simulé passent par le Payment Gateway (PSP_WEBHOOK_DELIVERY=http).
# Prérequis : pnpm build, base migrée et alimentée (pnpm db:migrate && pnpm db:seed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/apps/api"
EMAIL_DRIVER=memory PSP_WEBHOOK_DELIVERY=http node --env-file=../../.env dist/main.js > /tmp/tm-api.log 2>&1 &
API=$!
cd "$ROOT/apps/reporting-service"
EVENT_GROUP=reporting SERVICE_NAME=reporting node --env-file=../../.env dist/main.js > /tmp/tm-reporting.log 2>&1 &
REP=$!
cd "$ROOT/apps/api-gateway"
node --env-file=../../.env dist/main.js > /tmp/tm-gateway.log 2>&1 &
GW=$!
cd "$ROOT/apps/payment-gateway"
node --env-file=../../.env dist/main.js > /tmp/tm-payment-gateway.log 2>&1 &
PGW=$!
cd "$ROOT/apps/web"
node node_modules/next/dist/bin/next start -p 3000 > /tmp/tm-web.log 2>&1 &
WEB=$!
trap 'kill $API $REP $GW $PGW $WEB 2>/dev/null || true' EXIT
# Services extraits (étape 7) : attendus seulement s'ils sont activés
REPORTING_READY=true
if grep -Eq '^EXTRACTED_SERVICES=.*reporting' ../../.env; then REPORTING_READY=false; fi
for i in $(seq 1 60); do
  if [ "$REPORTING_READY" = false ] && curl -sf http://localhost:4100/health/ready >/dev/null; then REPORTING_READY=true; fi
  if [ "$REPORTING_READY" = true ] && curl -sf http://localhost:4000/health >/dev/null && curl -sf http://localhost:8080/health/ready >/dev/null && curl -sf http://localhost:8090/health/ready >/dev/null && curl -sf -o /dev/null http://localhost:3000/login; then break; fi
  sleep 1
done
npx playwright test "$@"
