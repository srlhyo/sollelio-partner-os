/**
 * Signs both people in, through the real magic-link flow, once per run.
 *
 * This is also the coverage for "an unauthenticated partner reaches the sign-in
 * flow" and "an authenticated partner reaches /partner": nothing is stubbed, the
 * session is obtained the way Nádia will obtain hers.
 */
import { expect, test as setup, type Page } from '@playwright/test';
import { deleteAllMail, waitForSignInLink } from './helpers/mail';
import { ORGANIZATION_NAME, PARTNER_EMAIL, STAFF_EMAIL } from './helpers/env';

async function signIn(page: Page, email: string, destination: string) {
  await deleteAllMail();

  // The destination rides along in the query string, so following the emailed link
  // lands on the page the person actually wanted (03_UX_SPEC.md §20).
  await page.goto(`/partner/sign-in?redirectTo=${encodeURIComponent(destination)}`);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  // No password exists anywhere in Partner OS.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: /Enviar link de acesso/i }).click();

  await expect(page.getByRole('heading', { name: /Veja o seu email/i })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  const link = await waitForSignInLink(email);
  await page.goto(link);

  // Exact, not a substring: `/partner` also matches `/partner/sign-in`, which would
  // let an unauthenticated page pass for a signed-in one.
  await expect(page).toHaveURL(new RegExp(`${destination.replace(/\//g, '\\/')}(\\?|$)`));
}

setup('partner signs in with a magic link', async ({ page }) => {
  await signIn(page, PARTNER_EMAIL, '/partner');

  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await expect(page.getByText(`O seu espaço · ${ORGANIZATION_NAME}`)).toBeVisible();

  await page.context().storageState({ path: '.auth/partner.json' });
});

setup('Sollelio operator signs in with a magic link', async ({ page }) => {
  // Also proves a deep link survives the trip through email: the operator asked for
  // the internal area and lands there, not on a generic home page.
  await signIn(page, STAFF_EMAIL, '/app/organizations');

  await expect(page.getByRole('heading', { name: 'Organizações' })).toBeVisible();

  await page.context().storageState({ path: '.auth/staff.json' });
});
