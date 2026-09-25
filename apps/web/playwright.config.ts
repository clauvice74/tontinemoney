import { defineConfig, devices } from '@playwright/test';

/**
 * Tests E2E navigateur (Playwright) contre l'API et le web démarrés localement avec les données
 * de démonstration (`pnpm db:seed`). Aucun service externe réel : PSP, SMS et KYC sont simulés.
 *   pnpm dev            # ou API + `next start`
 *   pnpm test:e2e
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE permet d'utiliser un Chromium préinstallé (CI, bac à sable).
 */
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    locale: 'fr-FR',
    timezoneId: 'Africa/Douala',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
});
