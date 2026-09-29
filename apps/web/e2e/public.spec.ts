import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Pages publiques', () => {
  test('accueil et accès à la connexion', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/TontineMoney/);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('build de démonstration : console des messages simulés accessible depuis l’en-tête', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Messages simulés' }).first().click();
    await expect(page).toHaveURL(/\/dev\/messages/);
    await expect(page.getByRole('heading', { name: 'Messages simulés' })).toBeVisible();
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
