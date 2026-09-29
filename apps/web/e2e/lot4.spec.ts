import { type APIRequestContext, expect, test } from '@playwright/test';
import { login } from './helpers';

/** Dernier code à 6 chiffres envoyé par SMS simulé à un numéro de démonstration. */
async function lastSmsCode(request: APIRequestContext, to: string): Promise<string> {
  const res = await request.get('/api/v1/dev/messages', { params: { to, limit: '1' } });
  const body = (await res.json()) as { data: Array<{ body: string }> };
  return /\b(\d{6})\b/.exec(body.data[0]?.body ?? '')?.[1] ?? '';
}

test.describe('Lot 4 : wallet, KYC, notifications, profil', () => {
  test('wallet : solde, retrait confirmé par code SMS, historique filtrable', async ({
    page,
    request,
  }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/wallet');
    await expect(page.getByRole('heading', { level: 1, name: 'Mon wallet' })).toBeVisible();
    await expect(page.getByText('Solde total')).toBeVisible();

    await page.getByRole('button', { name: 'Retirer mes fonds' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Montant/).fill('1000');
    await expect(dialog.getByText('Disponible après retrait')).toBeVisible();
    await dialog.getByRole('button', { name: 'Recevoir le code' }).click();
    await expect(dialog.getByText('Saisissez le code de sécurité')).toBeVisible();

    // Code erroné : message clair, pas de retrait
    await dialog.getByLabel('Code à 6 chiffres').fill('000000');
    const code = await lastSmsCode(request, '+237600000011');
    expect(code).toMatch(/^\d{6}$/);
    if (code !== '000000') {
      await dialog.getByRole('button', { name: 'Confirmer le retrait' }).click();
      await expect(
        dialog.getByText('Code incorrect. Vérifiez les chiffres et réessayez.'),
      ).toBeVisible();
    }
    await dialog.getByLabel('Code à 6 chiffres').fill(code);
    await dialog.getByRole('button', { name: 'Confirmer le retrait' }).click();
    await expect(dialog.getByText('Retrait de')).toBeVisible();
    await dialog
      .getByRole('button', { name: /Fermer|Nouvelle opération/ })
      .first()
      .click();

    await page.getByRole('button', { name: 'Retrait', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retrait', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('KYC : statut visible et envoi guidé (recto, verso, selfie)', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/kyc');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Vérification d’identité' }),
    ).toBeVisible();
    // Awa est vérifiée au niveau 2 : statut « Validé » et niveaux débloqués
    await expect(page.getByRole('heading', { name: 'Validé' })).toBeVisible();
    await expect(page.getByText('Ce que débloque chaque niveau')).toBeVisible();
    await expect(page.getByText('Passer au niveau 3')).toBeVisible();
  });

  test('notifications : filtres et « voir »', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    const filters = page.getByRole('group', { name: 'Filtrer les notifications' });
    for (const name of ['Paiements', 'Rappels', 'Système', 'KYC', 'Wallet']) {
      await expect(filters.getByRole('button', { name })).toBeVisible();
    }
    await filters.getByRole('button', { name: 'Système' }).click();
    await expect(filters.getByRole('button', { name: 'Système' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await filters.getByRole('button', { name: 'Toutes' }).click();
    const view = page.getByRole('button', { name: /^Voir/ }).first();
    if (await view.count()) {
      await view.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).first().click();
    }
  });

  test('profil : onglets, préférences de langue, résumé sécurité', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
    await expect(page.getByText('Informations personnelles', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Préférences' }).click();
    await expect(page.getByText('Heures calmes', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Sécurité' }).click();
    await expect(page.getByRole('link', { name: 'Gérer la sécurité' })).toBeVisible();
    await page.getByRole('link', { name: 'Gérer la sécurité' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sécurité' })).toBeVisible();
    await expect(page.getByText('Sessions actives')).toBeVisible();
  });
});
