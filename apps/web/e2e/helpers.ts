import { type Page, expect } from '@playwright/test';

export const DEMO_PASSWORD = 'Demo#Tontine2026';

export async function login(page: Page, email: string, password = DEMO_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.locator('#identifier').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

export async function expectLoggedIn(page: Page, path: RegExp): Promise<void> {
  await expect(page).toHaveURL(path);
}
