/**
 * Signs both people in, through the real magic-link flow, once per run.
 *
 * This is also the coverage for "an unauthenticated partner reaches the sign-in
 * flow" and "an authenticated partner reaches /partner": nothing is stubbed, the
 * session is obtained the way Nádia will obtain hers.
 */
import { expect, test as setup } from '@playwright/test';
import { signInThroughMagicLink } from './helpers/sign-in';
import { ORGANIZATION_NAME, PARTNER_EMAIL, STAFF_EMAIL } from './helpers/env';

setup('partner signs in with a magic link', async ({ page }) => {
  await signInThroughMagicLink(page, PARTNER_EMAIL, '/partner');

  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await expect(page.getByText(`O seu espaço · ${ORGANIZATION_NAME}`)).toBeVisible();

  await page.context().storageState({ path: '.auth/partner.json' });
});

setup('Sollelio operator signs in with a magic link', async ({ page }) => {
  // Also proves a deep link survives the trip through email: the operator asked for
  // the internal area and lands there, not on a generic home page.
  await signInThroughMagicLink(page, STAFF_EMAIL, '/app/organizations');

  await expect(page.getByRole('heading', { name: 'Organizações' })).toBeVisible();

  await page.context().storageState({ path: '.auth/staff.json' });
});
