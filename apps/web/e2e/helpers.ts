import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

export const DEMO_PASSWORD = 'Demo#Tontine2026';

/** Nombre maximal de réessais quand la connexion est limitée (429). */
const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Connexion par le formulaire. La limite de l'API (10 connexions / min / IP, US-1.4) s'applique à
 * toute la suite, jouée depuis une seule IP : sur un 429, on attend le délai `Retry-After`
 * annoncé puis on réessaie — la limite est respectée, pas contournée.
 */
export async function login(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill(password);
  for (let attempt = 0; ; attempt += 1) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Se connecter' }).click();
    const res = await response;
    if (res.status() !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return;
    const waitSeconds = Math.min(Number(res.headers()['retry-after'] ?? '5') || 5, 60) + 1;
    // L'attente s'ajoute à la durée du test sans consommer son budget.
    test.info().setTimeout(test.info().timeout + waitSeconds * 1000);
    await page.waitForTimeout(waitSeconds * 1000);
  }
}

export async function expectLoggedIn(page: Page, path: RegExp): Promise<void> {
  await expect(page).toHaveURL(path);
}

/** Super-admin : connexion puis second facteur SMS lu dans le simulateur de messages. */
export async function loginSuperAdmin(page: Page, request: APIRequestContext): Promise<void> {
  await login(page, 'superadmin@tontinemoney.local');
  const codeInput = page.getByLabel('Code de vérification');
  await expect(codeInput).toBeVisible();
  const res = await request.get('/api/v1/dev/messages', {
    params: { to: '+237600000001', limit: '1' },
  });
  const body = (await res.json()) as { data: Array<{ body: string }> };
  const code = /\b(\d{6})\b/.exec(body.data[0]?.body ?? '')?.[1] ?? '';
  await codeInput.fill(code);
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(page).toHaveURL(/\/admin/);
}
