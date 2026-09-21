/**
 * The partner/internal boundary, exercised in a real browser with a real partner
 * session.
 *
 * The guard here is a courtesy; RLS is the actual boundary, and it is proved in SQL
 * and by scripts/verify-pilot-path.mjs. What this asserts is that a partner who
 * follows an internal link is told where she is, and that no internal data renders.
 */
import { expect, test } from '@playwright/test';

test('a partner cannot reach the Sollelio area', async ({ page }) => {
  await page.goto('/app/organizations');

  await expect(page.getByText(/Esta área é da equipa Sollelio/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Organizações' })).toHaveCount(0);
});

test('a partner cannot reach an organization page inside the Sollelio area', async ({ page }) => {
  await page.goto('/app/organizations/do-luxo-a-mesa');

  await expect(page.getByText(/Esta área é da equipa Sollelio/i)).toBeVisible();
  await expect(page.getByText('Espaço da organização')).toHaveCount(0);
});
