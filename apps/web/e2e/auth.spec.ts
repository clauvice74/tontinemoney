import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

/** Lot 2 (A-56, A-57) : bienvenue, inscription, OTP, mot de passe, connexion, langue. */
test.describe('Parcours d’authentification', () => {
  test('bienvenue : promesse et deux entrées (créer un compte, se connecter)', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Épargnez ensemble, en toute confiance' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Créer mon compte' }).first().click();
    await expect(page).toHaveURL(/\/request-account/);
    await expect(page.getByRole('list', { name: 'Étapes de l’inscription' })).toBeVisible();
  });

  test('inscription : validation, envoi, étapes suivantes', async ({ page }) => {
    await page.goto('/request-account');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.locator('#lastName')).toHaveAttribute('aria-invalid', 'true');
    const n = String(Date.now()).slice(-8);
    await page.getByLabel(/^Nom/).fill('Essai');
    await page.getByLabel(/^Prénom/).fill('Parcours');
    await page.getByLabel(/^Téléphone/).fill(`+2376${n}`);
    await page.locator('#email').fill(`parcours.${n}@example.test`);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Demande envoyée' })).toBeVisible();
    await expect(page.getByText('Un administrateur valide votre demande.')).toBeVisible();
    await page.getByRole('link', { name: 'J’ai reçu mon code' }).click();
    await expect(page).toHaveURL(/\/activate$/);
  });

  test('activation : code à 6 chiffres puis mot de passe ; code refusé → retour au code', async ({
    page,
  }) => {
    await page.goto('/activate');
    await page.getByRole('button', { name: 'Valider le code' }).click();
    await expect(page.getByText('Saisissez les 6 chiffres du code')).toBeVisible();
    await page.getByLabel(/E-mail ou téléphone/).fill('inconnu@example.test');
    await page.getByLabel(/Code d’activation/).fill('123456');
    await page.getByRole('button', { name: 'Valider le code' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Créez votre mot de passe' }),
    ).toBeVisible();
    await page.getByLabel('Mot de passe', { exact: false }).first().fill('Cigale#Epargne2026');
    await page.getByLabel(/Confirmation du mot de passe/).fill('Cigale#Epargne2026');
    await page.getByRole('button', { name: 'Activer mon compte' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Saisissez votre code' }),
    ).toBeVisible();
    await expect(
      page.getByText('Code invalide. Vérifiez les chiffres et réessayez.'),
    ).toBeVisible();
    await expect(page.getByLabel(/E-mail ou téléphone/)).toHaveValue('inconnu@example.test');
  });

  test('« se souvenir de moi » décoché : cookie de session', async ({ page, context }) => {
    await page.goto('/login');
    await page.locator('#identifier').fill('awa@tontinemoney.local');
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.getByLabel('Se souvenir de moi').uncheck();
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const cookie = (await context.cookies()).find((c) => c.name === 'tm_rt');
    expect(cookie?.expires).toBe(-1);
  });

  test('langue : bascule en anglais, conservée au rechargement', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('button', { name: 'Français' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Se connecter' })).toBeVisible();
  });
});
