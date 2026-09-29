import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Administration', () => {
  test('admin de tontine : tableau de bord de sa tontine', async ({ page }) => {
    await login(page, 'admin.tontine@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/tontines');
    await page.getByRole('link', { name: /Voir les détails — Tontine Solidarité Douala/ }).click();
    await expect(page).toHaveURL(/\/tontines\/[0-9a-f-]{36}/);
  });

  test('admin de tontine : rapport CSV servi par le reporting-service (via le gateway)', async ({
    page,
  }) => {
    await login(page, 'admin.tontine@tontinemoney.local');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/tontines');
    await page.getByRole('link', { name: /Voir les détails — Tontine Solidarité Douala/ }).click();
    await expect(page).toHaveURL(/\/tontines\/[0-9a-f-]{36}/);
    const tontineId = /\/tontines\/([0-9a-f-]{36})/.exec(page.url())?.[1];
    await page.goto(`/tontines/${tontineId}/admin/reports`);
    await expect(page.getByRole('button', { name: 'Télécharger en CSV' })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Télécharger en CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^rapport-contributions-.*\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    expect(Buffer.concat(chunks).toString('utf8')).toContain('Membre');
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
