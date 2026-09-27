/** Mise en forme HTML minimale d'un email (échappement, liens cliquables). */
export function emailHtml(title: string, body: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const linked = esc(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937">
<h2 style="color:#0f766e">${esc(title)}</h2><p>${linked}</p>
<p style="font-size:12px;color:#6b7280">TontineMoney — message automatique, merci de ne pas répondre.</p>
</body></html>`;
}
