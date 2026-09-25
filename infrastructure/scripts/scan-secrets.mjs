#!/usr/bin/env node
/**
 * Détection de secrets dans les fichiers suivis par git (complément de gitleaks en CI).
 * Échoue (code 1) si un motif de secret réel est trouvé hors des valeurs de développement
 * explicitement marquées (`dev-only`, `test-`, `example`).
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PATTERNS = [
  ['Clé privée PEM', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Clé AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['Jeton GitHub', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Clé Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Clé Stripe', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ['Clé secrète Flutterwave', /\bFLWSECK(?:_TEST)?-[A-Za-z0-9]{20,}/],
  ['Clé secrète Paystack', /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ['Clé Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Jeton Twilio', /\bSK[0-9a-f]{32}\b/],
  ['Clé SendGrid', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/],
  [
    'URL avec mot de passe',
    /\b(?:postgres(?:ql)?|redis|amqp|mongodb):\/\/[^:\s/]+:(?!tontine@|password@|postgres@)[^@\s]{6,}@/,
  ],
];
const ALLOW = [/dev-only/i, /test-/i, /example/i, /change-me/i, /\$\{/];
const SKIP = [
  /^pnpm-lock\.yaml$/,
  /\.(png|jpe?g|gif|ico|pdf|woff2?)$/i,
  /^docs\/openapi\.json$/,
  /^infrastructure\/scripts\/scan-secrets\.mjs$/,
];

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !SKIP.some((r) => r.test(f)));
const findings = [];
for (const f of files) {
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (re.test(line) && !ALLOW.some((a) => a.test(line)))
        findings.push(`${f}:${i + 1} — ${name}`);
    }
  });
}
if (findings.length) {
  console.error(`✖ ${findings.length} secret(s) potentiel(s) :\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`✔ Aucun secret détecté (${files.length} fichiers analysés)`);
