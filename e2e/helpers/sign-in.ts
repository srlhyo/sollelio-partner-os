/**
 * The real magic-link sign-in, shared by the auth setup and the logout acceptance
 * test.
 *
 * Nothing here is simulated: it fills the real form, waits for the message Supabase
 * actually sent, and follows the link. PKCE works because the browser itself started
 * the flow, so the code verifier is the one the exchange needs.
 */
import { expect, type Page } from '@playwright/test';
import { deleteAllMail, waitForSignInLink } from './mail';

export async function signInThroughMagicLink(
  page: Page,
  email: string,
  destination: string,
  landsOn?: RegExp,
): Promise<void> {
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

  // `landsOn` differs from `destination` whenever the requested destination is not
  // one this person's role may use: the link still goes where it was minted to go,
  // and the application then routes them to their own surface.
  //
  // Exact, not a substring: `/partner` also matches `/partner/sign-in`, which would
  // let an unauthenticated page pass for a signed-in one.
  await expect(page).toHaveURL(
    landsOn ?? new RegExp(`${destination.replace(/\//g, '\\/')}(\\?|$)`),
  );
}

/** Whether the browser is holding a Supabase session right now. */
export async function storedSession(
  page: Page,
): Promise<{ present: boolean; refreshToken: string | null }> {
  return page.evaluate(() => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      // The session lives under `sb-<ref>-auth-token`; the PKCE verifier keys carry
      // suffixes and are not sessions.
      if (key && /^sb-.*-auth-token$/.test(key)) {
        const raw = window.localStorage.getItem(key);
        try {
          const parsed = raw ? (JSON.parse(raw) as { refresh_token?: string }) : null;
          return { present: true, refreshToken: parsed?.refresh_token ?? null };
        } catch {
          return { present: true, refreshToken: null };
        }
      }
    }
    return { present: false, refreshToken: null };
  });
}
