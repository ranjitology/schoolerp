import { defineConfig, devices } from '@playwright/test';

const browser = (process.env.E2E_BROWSER ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    timezoneId: 'Asia/Kathmandu',
  },
  projects: [
    {
      name: browser,
      use:
        browser === 'firefox'
          ? devices['Desktop Firefox']
          : browser === 'webkit'
            ? devices['Desktop Safari']
            : devices['Desktop Chrome'],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @schoolerp/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @schoolerp/admin-console dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
