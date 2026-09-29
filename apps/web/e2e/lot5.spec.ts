import { expect, test } from '@playwright/test';
import { login, loginSuperAdmin } from './helpers';

test.describe('Lot 5 : administration', () => {
  test('administrateur de tontine : indicateurs, membres (recherche, filtres), paramètres', async ({
    page,
  }) => {
    await login(page, 'admin.tontine@tontinemoney.local');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto('/tontines');
    await page.getByRole('link', { name: /Gérer — Tontine Solidarité Douala/ }).click();
    await expect(page).toHaveURL(/\/tontines\/[0-9a-f-]{36}\/admin$/);
    const kpis = page.getByRole('region', { name: 'Tableau de bord' });
    for (const label of [
      'Membres',
      'Total collecté',
      'Contributions du cycle',
      'Membres en retard',
      'Cycle',
    ]) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    }

    await page
      .getByRole('navigation', { name: 'Administration de la tontine' })
      .getByRole('link', { name: 'Membres', exact: true })
      .click();
    await expect(page.getByRole('searchbox', { name: 'Recherche' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Recherche' }).fill('Awa');
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(page.getByRole('cell', { name: /^Awa / })).toBeVisible();

    // Tontine déjà rejointe par des membres : configuration verrouillée (A-61)
    await page
      .getByRole('navigation', { name: 'Administration de la tontine' })
      .getByRole('link', { name: 'Paramètres' })
      .click();
    await expect(page.getByText('Configuration verrouillée')).toBeVisible();
  });

  test('administrateur : modification d’une tontine en brouillon', async ({ page }) => {
    await login(page, 'admin.tontine@tontinemoney.local');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto('/tontines/new');
    const name = `Tontine brouillon ${String(Date.now()).slice(-8)}`;
    await page.getByLabel('Nom de la tontine').fill(name);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByLabel('Montant de la contribution').fill('10000');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Créer la tontine' }).click();
    await expect(page).toHaveURL(/\/tontines\/[0-9a-f-]{36}$/);

    await page.getByRole('link', { name: 'Gérer la tontine' }).click();
    await page.getByRole('link', { name: 'Modifier la configuration' }).click();
    await expect(page.getByText('Étape 1 sur 3 — Type')).toBeVisible();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByLabel('Montant de la contribution').fill('12500');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText('12 500').first()).toBeVisible();
  });

  test('super-admin : tableau global, tontines, utilisateurs et audit', async ({
    page,
    request,
  }) => {
    await loginSuperAdmin(page, request);
    await page.goto('/admin');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tableau de bord de la plateforme' }),
    ).toBeVisible();
    await expect(page.getByText('Comptes actifs')).toBeVisible();
    await expect(page.getByText('Incidents et exploitation')).toBeVisible();

    await page.goto('/admin/tontines');
    await expect(
      page.getByRole('cell', { name: 'Tontine Solidarité Douala', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Statut').selectOption('CANCELLED');
    await expect(page.getByText('Aucune tontine pour ces critères.')).toBeVisible();
    await page.getByLabel('Statut').selectOption('');
    await page.getByLabel('Rechercher une tontine').fill('Solidarité');
    await expect(page.getByText('1 tontine(s)')).toBeVisible();

    await page.goto('/admin/users');
    await expect(page.getByRole('link', { name: 'Créer un administrateur' })).toBeVisible();
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Journal d’audit' })).toBeVisible();
  });
});
