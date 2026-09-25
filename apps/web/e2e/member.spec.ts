import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Parcours membre (Awa, KYC niveau 2)', () => {
  test('tableau de bord, tontine de démonstration et participants', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/tontines');
    await expect(page.getByText('Tontine Solidarité Douala').first()).toBeVisible();
    await page.getByText('Tontine Solidarité Douala').first().click();
    await expect(page).toHaveURL(/\/tontines\/[0-9a-f-]{36}/);
  });

  test('dépôt Mobile Money simulé : confirmation USSD puis crédit du portefeuille', async ({
    page,
  }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/wallet');
    await page.getByRole('tab', { name: 'Déposer' }).click();
    await page.getByLabel(/Montant/).fill('1500');
    await page.getByLabel('Numéro Mobile Money').fill('+237677001122');
    await page.getByRole('button', { name: 'Déposer' }).click();
    await page.getByRole('button', { name: 'Simuler la confirmation USSD' }).click();
    await expect(page.getByText('Votre portefeuille a été crédité.')).toBeVisible({
      timeout: 20_000,
    });
  });

  test('isolation des rôles : un membre n’accède pas à l’administration de la plateforme', async ({
    page,
  }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/admin/audit');
    await expect(page.getByText('Accès refusé')).toBeVisible();
  });
});

test.describe('Agent KYC', () => {
  test('accède à la file de revue', async ({ page }) => {
    await login(page, 'agent.kyc@tontinemoney.local');
    await expect(page).toHaveURL(/\/kyc-review/);
    await expect(page.getByRole('heading', { name: 'File de revue KYC' })).toBeVisible();
  });
});
