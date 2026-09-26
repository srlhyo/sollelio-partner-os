/**
 * The Sollelio internal surface, signed in as the operator.
 */
import { expect, test } from '@playwright/test';
import { ORGANIZATION_NAME } from './helpers/env';

test('the operator reaches the organization surface', async ({ page }) => {
  await page.goto('/app/organizations');

  await expect(page.getByRole('heading', { name: 'Organizações' })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(ORGANIZATION_NAME) }).click();

  await expect(page).toHaveURL(/\/app\/organizations\/do-luxo-a-mesa/);
  await expect(page.getByText('Espaço da organização')).toBeVisible();
  await expect(page.getByRole('heading', { name: ORGANIZATION_NAME })).toBeVisible();
});

test('global and organization scope are visibly different', async ({ page }) => {
  await page.goto('/app/organizations');
  await expect(page.getByText('Toda a Sollelio')).toBeVisible();
  await expect(page.getByText('Espaço da organização')).toHaveCount(0);

  await page.goto('/app/organizations/do-luxo-a-mesa');
  await expect(page.getByText('Espaço da organização')).toBeVisible();
});

test('the operator sees canonical resources, including the superseded one', async ({ page }) => {
  await page.goto('/app/organizations/do-luxo-a-mesa/resources');

  await expect(page.getByText('Espaço da organização')).toBeVisible();
  await expect(page.getByText('Sollelio Events').first()).toBeVisible();
  // What the partner must not see, the operator must.
  await expect(page.getByText('Events (endereço antigo)')).toBeVisible();
  await expect(page.getByText('Notas internas')).toBeVisible();
});

test('the operator sees the organization members', async ({ page }) => {
  await page.goto('/app/organizations/do-luxo-a-mesa/people');

  const members = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Membros' }) });
  await expect(members).toBeVisible();
  await expect(members.getByText('Nádia')).toBeVisible();

  // Staff identity is global: the operator is not a member of the tenant. Scoped to
  // the panel, because his own name is in the sidebar as the signed-in user.
  await expect(members.getByText('Hélio Schultz')).toHaveCount(0);
});

test('only the tabs whose slices exist are offered', async ({ page }) => {
  await page.goto('/app/organizations/do-luxo-a-mesa');

  await expect(page.getByRole('link', { name: 'Pedidos' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recursos' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pessoas' })).toBeVisible();

  for (const absent of ['Problemas', 'Atualizações', 'Atividade']) {
    await expect(page.getByRole('link', { name: absent })).toHaveCount(0);
  }
});
