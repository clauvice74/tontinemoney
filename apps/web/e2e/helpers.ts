import { type Page, expect, test } from '@playwright/test';

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
