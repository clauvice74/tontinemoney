import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Lot 3 : accueil, tontines, création, invitation', () => {
  test('accueil membre : solde, prochaine contribution, tontines actives', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1, name: /Bonjour Awa/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Solde du wallet' })).toBeVisible();
    await expect(page.getByText('Disponible', { exact: true })).toBeVisible();
    await expect(page.getByText('Prochaine contribution')).toBeVisible();
    await expect(page.getByText('Tontines actives')).toBeVisible();
  });

  test('détail : progression, onglets, solde affiché avant paiement', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/tontines');
    await page.getByRole('link', { name: /Voir les détails — Tontine Solidarité Douala/ }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tontine Solidarité Douala' }),
    ).toBeVisible();
    await expect(page.getByText('Informations générales')).toBeVisible();
    await expect(page.getByText(/Cycle 1 — /)).toBeVisible();

    await page.getByRole('tab', { name: 'Membres' }).click();
    await expect(
      page.getByRole('tabpanel').getByText('Awa', { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Mes contributions' }).click();
    const pay = page.getByRole('tabpanel').getByRole('button', { name: 'Payer ma contribution' });
    if (await pay.count()) {
      await pay.first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Solde disponible')).toBeVisible();
      await expect(dialog.getByText('Solde après paiement')).toBeVisible();
      await dialog.getByRole('button', { name: 'Annuler' }).click();
      await expect(dialog).toBeHidden();
    }
  });

  test('assistant de création en 4 étapes avec invitation', async ({ page }) => {
    await login(page, 'admin.tontine@tontinemoney.local');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto('/tontines/new');
    await expect(page.getByText('Étape 1 sur 4 — Type')).toBeVisible();

    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.locator('#name-error')).toBeVisible();
    await page.getByLabel('Nom de la tontine').fill('Tontine E2E lot 3');
    await page.getByRole('button', { name: 'Continuer' }).click();

    await expect(page.getByText('Étape 2 sur 4 — Montant')).toBeVisible();
    await page.getByLabel('Montant de la contribution').fill('15000');
    await expect(page.getByText('Chaque bénéficiaire reçoit environ')).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();

    await expect(page.getByText('Étape 3 sur 4 — Règles')).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();

    await expect(page.getByText('Étape 4 sur 4 — Invitations')).toBeVisible();
    await page.getByLabel('E-mails ou téléphones').fill('pas-un-contact');
    await page.getByRole('button', { name: 'Créer la tontine' }).click();
    await expect(page.getByText(/Ligne 1 : ni un e-mail/)).toBeVisible();
    await page.getByLabel('E-mails ou téléphones').fill('invite.e2e@example.org');
    await page.getByRole('button', { name: 'Retour' }).click();
    await expect(page.getByText('Étape 3 sur 4 — Règles')).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Créer la tontine' }).click();

    await expect(page).toHaveURL(/\/tontines\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tontine E2E lot 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inviter un membre' })).toBeVisible();
  });

  test('invitation par lien : aperçu public puis code invalide', async ({ page }) => {
    await page.goto('/invitations/code-inexistant-e2e');
    await expect(page.getByText('Invitation introuvable ou expirée')).toBeVisible();
  });
});
