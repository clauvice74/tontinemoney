import { type NotificationChannel, baseLanguage } from '@tontine/contracts';
import { TEMPLATES, type TemplateKey } from './templates';

export type TemplateVars = Record<string, string | number | null | undefined>;

/** Pays dont les opérateurs SMS gèrent mal les caractères accentués (R-COM-01). */
export const SMS_ASCII_COUNTRIES = new Set(['CM', 'CI', 'SN', 'GA', 'BJ', 'TG', 'CD', 'NG', 'GH']);
export const SMS_MAX_LENGTH = 160;

export function stripAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u00ab\u00bb\u201c\u201d]/g, '"')
    .replace(/[\u202f\u00a0]/g, ' ');
}

function interpolate(text: string, vars: TemplateVars, mask: Set<string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (mask.has(key)) return '••••••';
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

export interface RenderedMessage {
  title: string;
  body: string;
}

/**
 * Rend un modèle pour un canal et une langue (US-8.2) :
 * SMS court (≤ 160 caractères, sans accents selon le pays), email/in-app complet.
 * `maskSensitive` produit la version stockée dans l'historique (liens et codes masqués).
 */
export function renderTemplate(
  key: TemplateKey,
  channel: NotificationChannel,
  language: string | null | undefined,
  vars: TemplateVars,
  options: { country?: string | null; maskSensitive?: boolean } = {},
): RenderedMessage {
  const tpl = TEMPLATES[key];
  const loc = tpl[baseLanguage(language)];
  const mask = new Set(
    options.maskSensitive ? ((tpl as { sensitive?: string[] }).sensitive ?? []) : [],
  );
  const title = interpolate(loc.title, vars, mask);
  if (channel === 'SMS') {
    let body = interpolate((loc as { sms?: string }).sms ?? loc.body, vars, mask);
    if (options.country && SMS_ASCII_COUNTRIES.has(options.country)) body = stripAccents(body);
    if (body.length > SMS_MAX_LENGTH) body = `${body.slice(0, SMS_MAX_LENGTH - 1)}…`;
    return { title, body };
  }
  return { title, body: interpolate(loc.body, vars, mask) };
}

export function emailHtml(title: string, body: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const linked = esc(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937">
<h2 style="color:#0f766e">${esc(title)}</h2><p>${linked}</p>
<p style="font-size:12px;color:#6b7280">TontineMoney — message automatique, merci de ne pas répondre.</p>
</body></html>`;
}
