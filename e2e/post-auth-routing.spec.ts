/**
 * Where a real magic link actually lands, per role.
 *
 * This is the staging defect, reproduced against the real stack: a Sollelio operator
 * completed authentication and was put into Partner UX. Authorization was never the
 * problem — the destination was chosen before anyone knew the role.
 *
 * Each test signs in for itself; none reuses the shared stored session.
 */
import { expect, test } from '@playwright/test';
import { signInThroughMagicLink } from './helpers/sign-in';
import { ORGANIZATION_NAME, PARTNER_EMAIL, STAFF_EMAIL } from './helpers/env';

test('staff authenticating towards the partner surface land in Sollelio internal', async ({
  page,
}) => {
  // The link is minted for /partner — exactly what happened in staging.
  await signInThroughMagicLink(page, STAFF_EMAIL, '/partner', /\/app\/organizations/);

  await expect(page.getByRole('heading', { name: 'Organizações' })).toBeVisible();
  await expect(page.getByText('Toda a Sollelio')).toBeVisible();
  // And not in the partner experience.
  await expect(page.getByRole('heading', { name: /Olá/ })).toHaveCount(0);
  await expect(page.getByText(`O seu espaço · ${ORGANIZATION_NAME}`)).toHaveCount(0);
});

test('staff keep a valid internal destination through the link', async ({ page }) => {
  await signInThroughMagicLink(page, STAFF_EMAIL, '/app/organizations/do-luxo-a-mesa/people');

  await expect(page.getByRole('heading', { name: 'Membros' })).toBeVisible();
  await expect(page.getByText('Espaço da organização')).toBeVisible();
});

test('a partner authenticating stays in the partner experience', async ({ page }) => {
  await signInThroughMagicLink(page, PARTNER_EMAIL, '/partner');

  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await expect(page.getByText(`O seu espaço · ${ORGANIZATION_NAME}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Organizações' })).toHaveCount(0);
});

test('a partner keeps a valid partner destination through the link', async ({ page }) => {
  await signInThroughMagicLink(page, PARTNER_EMAIL, '/partner/resources');

  await expect(page.getByRole('heading', { name: 'Recursos' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Sollelio Events/ })).toBeVisible();
});

test('a partner aimed at the internal surface is returned to her own', async ({ page }) => {
  await signInThroughMagicLink(page, PARTNER_EMAIL, '/app/organizations', /\/partner(\?|$)/);

  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Organizações' })).toHaveCount(0);
});
