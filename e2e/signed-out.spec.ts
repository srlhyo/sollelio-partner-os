/**
 * What an unauthenticated visitor meets.
 */
import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('a deep link into the partner surface reaches the sign-in flow', async ({ page }) => {
  await page.goto('/partner/resources');

  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  // The destination is carried through, so the link survives authentication.
  expect(decodeURIComponent(page.url())).toContain('redirectTo=/partner/resources');
});

test('a deep link to a Request survives the trip through sign-in', async ({ page }) => {
  const path = '/partner/requests/7f1c1f6e-3f55-4d69-9b3c-1b2f0b5a9d10';
  await page.goto(path);

  await expect(page).toHaveURL(/\/partner\/sign-in/);
  expect(decodeURIComponent(page.url())).toContain(`redirectTo=${path}`);
});

test('the internal surface is not reachable without a session', async ({ page }) => {
  await page.goto('/app/organizations');
  await expect(page).toHaveURL(/\/partner\/sign-in/);
});

test('an expired link explains itself and offers a way back', async ({ page }) => {
  await page.goto('/partner/link-expired');

  await expect(page.getByRole('heading', { name: /Este link já não funciona/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Pedir novo link/i })).toBeVisible();
});
