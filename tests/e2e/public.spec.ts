import { expect, test } from '@playwright/test';

test.describe('tenant web shell', () => {
  test.use({ baseURL: 'http://localhost:5173' });

  test('redirects anonymous visitors to sign in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('has a skip link and labelled form controls', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /skip to content/i })).toHaveCount(1);
    await expect(page.getByLabel(/school/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('supports keyboard focus order into the form', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.id ?? '');
    expect(active.length).toBeGreaterThan(0);
  });
});

test.describe('platform console', () => {
  test.use({ baseURL: 'http://localhost:5174' });

  test('shows the operator sign-in screen', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in to console/i })).toBeVisible();
    await expect(page.getByText(/restricted to platform operators/i)).toBeVisible();
  });

  test('does not expose school navigation before authentication', async ({ page }) => {
    await page.goto('/schools');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('link', { name: /^schools$/i })).toHaveCount(0);
  });
});
