/**
 * Signing a Sollelio operator out, end to end, against the real Supabase stack.
 *
 * Like the partner logout test, this signs in for itself rather than reusing the
 * stored staff session, because it ends by revoking that session server-side. It
 * must not pull the ground out from under the suites that share `.auth/staff.json`.
 *
 * The acceptance question behind it: an operator must be able to leave through the
 * product and come back through a fresh magic link — no DevTools, no clearing
 * storage by hand.
 */
import { expect, test } from '@playwright/test';
import { signInThroughMagicLink, storedSession } from './helpers/sign-in';
import { ANON_KEY, ORGANIZATION_NAME, STAFF_EMAIL, SUPABASE_URL } from './helpers/env';

const INTERNAL_ROUTES = [
  '/app/organizations',
  '/app/organizations/do-luxo-a-mesa',
  '/app/organizations/do-luxo-a-mesa/resources',
  '/app/organizations/do-luxo-a-mesa/people',
];

test('the operator signs out, and stays out', async ({ page, request }) => {
  await signInThroughMagicLink(page, STAFF_EMAIL, '/app/organizations');
  await expect(page.getByRole('heading', { name: 'Organizações' })).toBeVisible();

  const before = await storedSession(page);
  expect(before.present).toBe(true);
  expect(before.refreshToken).toBeTruthy();

  // Move deeper, so Back has somewhere authenticated to return to.
  await page.goto('/app/organizations/do-luxo-a-mesa');
  await expect(page.getByText('Espaço da organização')).toBeVisible();

  // The action is visible inside the shell, next to the operator's own name.
  const sair = page.getByRole('button', { name: 'Sair' });
  await expect(sair).toBeVisible();

  // It is reachable by keyboard, with visible focus.
  await sair.focus();
  await expect(sair).toBeFocused();

  await sair.click();

  // The shared sign-in flow — there is one, for both roles.
  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  // The browser holds no session...
  await expect
    .poll(async () => (await storedSession(page)).present, { timeout: 5_000 })
    .toBe(false);

  // ...and the session is gone server-side, not merely forgotten locally.
  const refreshed = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    data: { refresh_token: before.refreshToken },
    failOnStatusCode: false,
  });
  expect(refreshed.ok()).toBe(false);

  // No internal route renders authenticated content any more.
  for (const route of INTERNAL_ROUTES) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/partner\/sign-in/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
    await expect(page.getByText('Toda a Sollelio')).toHaveCount(0);
    await expect(page.getByText('Espaço da organização')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0);
  }

  // Back does not restore it.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByText('Espaço da organização')).toHaveCount(0);

  // Nor does reloading.
  await page.reload();
  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('the operator can sign in again afterwards and lands back in Sollelio internal', async ({
  page,
}) => {
  // The acceptance flow this correction unblocks: leave through the product, come
  // back through a fresh magic link, arrive where an operator belongs.
  await signInThroughMagicLink(page, STAFF_EMAIL, '/app/organizations');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  // GoTrue enforces a minimum interval between two magic links to the same address.
  // That is a real product constraint, not a test artefact, so the test waits it out
  // rather than the stack being told to stop enforcing it.
  await page.waitForTimeout(1_200);

  // A brand-new link, requested from the shared sign-in screen with no destination
  // of its own: role-aware routing decides where it lands.
  await signInThroughMagicLink(page, STAFF_EMAIL, '/partner', /\/app\/organizations/);

  await expect(page.getByRole('heading', { name: 'Organizações' })).toBeVisible();
  await expect(page.getByText('Toda a Sollelio')).toBeVisible();
  await expect(page.getByText(`O seu espaço · ${ORGANIZATION_NAME}`)).toHaveCount(0);
});
