import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Administration', () => {
  test('admin de tontine : tableau de bord de sa tontine', async ({ page }) => {
    await login(page, 'admin.tontine@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/tontines');
    await page.getByText('Tontine Solidarité Douala').first().click();
    await expect(page).toHaveURL(/\/tontines\/[0-9a-f-]{36}/);
  });

  test('super-admin : double authentification SMS (code lu dans le simulateur) puis journal d’audit', async ({
    page,
    request,
  }) => {
    await login(page, 'superadmin@tontinemoney.local');
    const codeInput = page.getByLabel('Code de vérification');
    await expect(codeInput).toBeVisible();
    // SMS simulé : lecture du dernier message envoyé au numéro de démonstration
    const res = await request.get('/api/v1/dev/messages', {
      params: { to: '+237600000001', limit: '1' },
    });
    const body = (await res.json()) as { data: Array<{ body: string }> };
    const code = /\b(\d{6})\b/.exec(body.data[0]?.body ?? '')?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);
    await codeInput.fill(code);
    await page.getByRole('button', { name: 'Vérifier' }).click();
    await expect(page).toHaveURL(/\/admin/);
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Journal d’audit' })).toBeVisible();
    await expect(
      page.getByText('user.login').first().or(page.getByText('auth').first()),
    ).toBeVisible();
  });
});
