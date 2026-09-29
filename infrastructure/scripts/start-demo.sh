#!/usr/bin/env bash
# Lance TontineMoney en mode démonstration : services compilés (dist) et web en `next start`,
# sans rechargement à chaud — stable, contrairement à `pnpm dev` qui redémarre tous les
# services à chaque fichier modifié. Journaux dans .logs/, arrêt de tous les services par Ctrl+C.
#
#   pnpm start:demo            # utilise le dernier build
#   pnpm start:demo --build    # pnpm build:demo d'abord (simulateurs visibles dans le web)
#
# Prérequis : .env, base migrée et alimentée (pnpm db:migrate && pnpm db:roles && pnpm db:seed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$ROOT/.logs"
mkdir -p "$LOG"
cd "$ROOT"

if [ "${1:-}" = "--build" ]; then
  pnpm build:demo
fi

for d in apps/api apps/reporting-service apps/api-gateway apps/payment-gateway; do
  if [ ! -f "$d/dist/main.js" ]; then
    echo "✖ $d/dist absent : lancez « pnpm start:demo --build » (ou pnpm build:demo)." >&2
    exit 1
  fi
done
if [ ! -d apps/web/.next ]; then
  echo "✖ build du web absent : lancez « pnpm start:demo --build »." >&2
  exit 1
fi

busy=""
for port in 3000 4000 4100 8080 8090; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then busy="$busy $port"; fi
done
if [ -n "$busy" ]; then
  echo "✖ Ports déjà utilisés :$busy (arrêtez pnpm dev ou une instance précédente)." >&2
  exit 1
fi

(cd apps/api && PSP_WEBHOOK_DELIVERY=http node --env-file=../../.env dist/main.js >"$LOG/api.log" 2>&1) &
(cd apps/reporting-service && EVENT_GROUP=reporting SERVICE_NAME=reporting \
  node --env-file=../../.env dist/main.js >"$LOG/reporting.log" 2>&1) &
(cd apps/api-gateway && node --env-file=../../.env dist/main.js >"$LOG/gateway.log" 2>&1) &
(cd apps/payment-gateway && node --env-file=../../.env dist/main.js >"$LOG/payment-gateway.log" 2>&1) &
(cd apps/web && node node_modules/next/dist/bin/next start -p 3000 >"$LOG/web.log" 2>&1) &
trap 'echo; echo "Arrêt des services…"; kill $(jobs -p) 2>/dev/null || true' EXIT INT TERM

# Le reporting-service n'est attendu que s'il est extrait (EXTRACTED_SERVICES, A-55).
REPORTING=false
if grep -Eq '^EXTRACTED_SERVICES=.*reporting' .env; then REPORTING=true; fi
ready() {
  curl -sf http://localhost:4000/health >/dev/null &&
    curl -sf http://localhost:8080/health/ready >/dev/null &&
    curl -sf http://localhost:8090/health/ready >/dev/null &&
    curl -sf -o /dev/null http://localhost:3000/login &&
    { [ "$REPORTING" = false ] || curl -sf http://localhost:4100/health/ready >/dev/null; }
}
for _ in $(seq 1 90); do
  if ready; then break; fi
  sleep 1
done
if ! ready; then
  echo "✖ Les services ne répondent pas après 90 s : voir $LOG/*.log" >&2
  exit 1
fi

cat <<EOF
✔ TontineMoney est prêt.
  Application web      http://localhost:3000
  API (gateway)        http://localhost:8080/api/v1
  Swagger              http://localhost:4000/api/docs
  Messages simulés     http://localhost:3000/dev/messages  (codes SMS / e-mail)
  Comptes de démo      voir « pnpm db:seed » (packages/database/prisma/seed.ts)
  Journaux             $LOG/
Ctrl+C pour tout arrêter.
EOF
wait
