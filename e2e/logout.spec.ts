/**
 * Signing out, end to end, against the real Supabase stack.
 *
 * This test signs in for itself rather than reusing the stored session, because it
 * ends by terminating that session: `signOut()` revokes the refresh token on the
 * server, so it must not pull the ground out from under the other suites.
 *
 * The point of the test is that the session is genuinely gone — not that a button
 * hid some UI. It checks three independent things: the browser is holding no
 * session, the refresh token Supabase issued no longer works, and no protected route
 * renders again by any route back into it.
 */
import { expect, test } from '@playwright/test';
import { signInThroughMagicLink, storedSession } from './helpers/sign-in';
import { ANON_KEY, PARTNER_EMAIL, SUPABASE_URL } from './helpers/env';

test('the partner signs out, and stays out', async ({ page, request }) => {
  // 1. Sign in for real.
  await signInThroughMagicLink(page, PARTNER_EMAIL, '/partner');
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();

  const before = await storedSession(page);
  expect(before.present).toBe(true);
  expect(before.refreshToken).toBeTruthy();

  // Visit a second protected page, so Back has somewhere authenticated to return to.
  await page.goto('/partner/resources');
  await expect(page.getByRole('heading', { name: 'Recursos' })).toBeVisible();

  // 2. The action is visible to an authenticated partner.
  const sair = page.getByRole('button', { name: 'Sair' });
  await expect(sair).toBeVisible();

  // 3. Activate it.
  await sair.click();

  // 5. The browser reaches sign-in.
  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  // 4a. The browser is holding no session.
  await expect
    .poll(async () => (await storedSession(page)).present, { timeout: 5_000 })
    .toBe(false);

  // 4b. And the session is gone server-side, not merely forgotten locally: the
  //     refresh token Supabase issued is no longer redeemable.
  const refreshed = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: { refresh_token: before.refreshToken },
    failOnStatusCode: false,
  });
  expect(refreshed.ok()).toBe(false);

  // 6. Direct navigation to /partner grants nothing.
  await page.goto('/partner');
  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('heading', { name: /Olá/ })).toHaveCount(0);

  // 7. Nor to /partner/resources.
  await page.goto('/partner/resources');
  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('link', { name: /Sollelio Events/ })).toHaveCount(0);

  // 8. Going back does not restore access.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recursos' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0);

  // 9. Reloading stays signed out.
  await page.reload();
  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('a signed-out visitor is never offered Sair', async ({ page }) => {
  await page.goto('/partner/sign-in');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0);
});
