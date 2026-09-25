import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Pages publiques', () => {
  test('accueil et accès à la connexion', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/TontineMoney/);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('identifiants invalides : message générique, pas de connexion', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local', 'mauvais-mot-de-passe');
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('espace connecté protégé : redirection vers la connexion', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/login\?next=%2Fwallet/);
  });
});
