/**
 * What an unusable email authentication link does, against the real stack.
 *
 * The link is made unusable the way it happens in life, not by crafting a URL: a
 * genuine magic link is requested through the real form, consumed once so a session
 * is established, and then opened a second time in a **fresh browser context** — a
 * separate cookie jar and separate storage, which is what an incognito window is.
 *
 * Supabase then refuses the token and redirects with
 * `#error=access_denied&error_code=otp_expired`, and the application must say so.
 */
import { expect, test } from '@playwright/test';
import { deleteAllMail, waitForSignInLink } from './helpers/mail';
import { storedSession } from './helpers/sign-in';
import { PARTNER_EMAIL } from './helpers/env';

test('a link that has already been used explains itself instead of a blank sign-in', async ({
  page,
  browser,
}) => {
  // --- Obtain one genuine link, through the real form ---
  await deleteAllMail();
  await page.goto('/partner/sign-in');
  await page.getByLabel('Email').fill(PARTNER_EMAIL);
  await page.getByRole('button', { name: /Enviar link de acesso/i }).click();
  await expect(page.getByRole('heading', { name: /Veja o seu email/i })).toBeVisible();

  const link = await waitForSignInLink(PARTNER_EMAIL);

  // --- Consume it once, successfully ---
  await page.goto(link);
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  expect((await storedSession(page)).present).toBe(true);

  // --- Open the very same link again, in a fresh context ---
  const incognito = await browser.newContext();
  const second = await incognito.newPage();

  try {
    await second.goto(link);

    // It lands on the expired-link screen, not on a bare sign-in form.
    await expect(second).toHaveURL(/\/partner\/link-expired/);
    await expect(second.getByRole('heading', { name: /Este link já não funciona/i })).toBeVisible();
    await expect(second.getByText(/já foi usado ou entretanto expirou/i)).toBeVisible();
    await expect(second.getByRole('link', { name: /Pedir novo link/i })).toBeVisible();

    // No session was fabricated.
    expect((await storedSession(second)).present).toBe(false);

    // No protected content of either surface rendered, at any point.
    await expect(second.getByRole('heading', { name: /Olá/ })).toHaveCount(0);
    await expect(second.getByRole('link', { name: /Sollelio Events/ })).toHaveCount(0);
    await expect(second.getByRole('heading', { name: 'Organizações' })).toHaveCount(0);
    await expect(second.getByText('Toda a Sollelio')).toHaveCount(0);
    await expect(second.getByRole('button', { name: 'Sair' })).toHaveCount(0);

    // Nothing from Supabase is shown to the person.
    const shown = (await second.locator('body').textContent()) ?? '';
    for (const leak of ['otp_expired', 'access_denied', 'error_code', 'Email link is invalid']) {
      expect(shown).not.toContain(leak);
    }

    // Protected routes remain protected afterwards.
    await second.goto('/partner/resources');
    await expect(second).toHaveURL(/\/partner\/(sign-in|link-expired)/);
    await expect(second.getByRole('link', { name: /Sollelio Events/ })).toHaveCount(0);
  } finally {
    await incognito.close();
  }
});

test('the way back from the expired-link screen works', async ({ page }) => {
  await page.goto('/partner/link-expired');
  await page.getByRole('link', { name: /Pedir novo link/i }).click();

  await expect(page).toHaveURL(/\/partner\/sign-in/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});
