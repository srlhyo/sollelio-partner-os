/**
 * The partner/internal boundary, exercised in a real browser with a real partner
 * session.
 *
 * Routing here is a courtesy on top of the real boundary; RLS is what actually
 * decides, and it is proved in SQL and by scripts/verify-pilot-path.mjs. What this
 * asserts is that a partner who follows an internal link never sees internal
 * content, and is returned to her own space rather than left somewhere she cannot
 * use.
 */
import { expect, test } from '@playwright/test';

test('a partner cannot reach the Sollelio area', async ({ page }) => {
  await page.goto('/app/organizations');

  await expect(page).toHaveURL(/\/partner(\?|$)/);
  await expect(page.getByRole('heading', { name: 'Organizações' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
});

test('a partner cannot reach an organization page inside the Sollelio area', async ({ page }) => {
  await page.goto('/app/organizations/do-luxo-a-mesa');

  await expect(page).toHaveURL(/\/partner(\?|$)/);
  await expect(page.getByText('Espaço da organização')).toHaveCount(0);
});

test('a partner cannot reach internal people or resources', async ({ page }) => {
  for (const path of [
    '/app/organizations/do-luxo-a-mesa/people',
    '/app/organizations/do-luxo-a-mesa/resources',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/partner(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Membros' })).toHaveCount(0);
    await expect(page.getByText('Notas internas')).toHaveCount(0);
  }
});
