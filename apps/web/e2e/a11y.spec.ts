import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { login } from './helpers';

/** WCAG 2.1 AA (charte : contraste AA sur toutes les combinaisons fond / texte). */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

test.describe('Accessibilité WCAG AA (axe-core)', () => {
  test('UI kit : thème clair puis sombre', async ({ page, context }) => {
    await page.goto('/dev/ui-kit');
    await expect(page.getByRole('heading', { name: 'Design system TontineMoney' })).toBeVisible();
    await expectAccessible(page);
    await context.addCookies([{ name: 'tm_theme', value: 'dark', url: page.url() }]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectAccessible(page);
  });

  for (const path of ['/', '/login', '/request-account', '/activate', '/forgot-password'])
    test(`page publique ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });

  test('page publique /login en mobile', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/login');
    await expectAccessible(page);
  });

  test('accueil membre : sidebar, barre du haut', async ({ page }) => {
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
    await expectAccessible(page);
  });

  test('accueil membre sur mobile : barre basse', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, 'awa@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('navigation', { name: 'Navigation mobile' })).toBeVisible();
    await expectAccessible(page);
  });

  test('tontines : liste, détail et assistant de création', async ({ page }) => {
    await login(page, 'admin.tontine@tontinemoney.local');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto('/tontines');
    await expect(page.getByRole('heading', { level: 1, name: 'Mes tontines' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: /Voir les détails — Tontine Solidarité Douala/ }).click();
    await expect(page.getByText('Informations générales')).toBeVisible();
    await expect(page.getByText(/Cycle 1 — /)).toBeVisible();
    await expectAccessible(page);
    await page.goto('/tontines/new');
    await expect(page.getByText('Étape 1 sur 4 — Type')).toBeVisible();
    await expectAccessible(page);
  });
});
