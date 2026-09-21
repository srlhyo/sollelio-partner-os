/**
 * The partner experience, signed in as Nádia against real data.
 */
import { expect, test } from '@playwright/test';
import { HIDDEN_RESOURCES, ORGANIZATION_NAME, VISIBLE_RESOURCES } from './helpers/env';

test('Home names the workspace and carries the platform brand', async ({ page }) => {
  await page.goto('/partner');

  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await expect(page.getByText(`O seu espaço · ${ORGANIZATION_NAME}`)).toBeVisible();
  // The header is the platform, not the tenant.
  await expect(page.getByText('Partner OS')).toBeVisible();
});

test('Home offers the canonical resources', async ({ page }) => {
  await page.goto('/partner');

  await expect(page.getByRole('heading', { name: 'Acesso rápido' })).toBeVisible();
  const events = page.getByRole('link', { name: /Sollelio Events/ });
  await expect(events).toBeVisible();
  await expect(events).toHaveAttribute('href', 'https://events.example.test/do-luxo-a-mesa');
  await expect(events).toHaveAttribute('rel', /noopener/);
});

test('the Resources page lists every canonical link, and only those', async ({ page }) => {
  await page.goto('/partner');
  await page.getByRole('link', { name: /Ver todos os recursos/i }).click();

  await expect(page).toHaveURL(/\/partner\/resources/);
  await expect(page.getByRole('heading', { name: 'Recursos' })).toBeVisible();

  for (const name of VISIBLE_RESOURCES) {
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  }

  // RLS decides this, and the rendered page must agree with it.
  for (const hidden of HIDDEN_RESOURCES) {
    await expect(page.getByText(hidden)).toHaveCount(0);
  }
});

test('resources open outward, in a new tab', async ({ page }) => {
  await page.goto('/partner/resources');

  const website = page.getByRole('link', { name: /Site Do Luxo à Mesa/ });
  await expect(website).toHaveAttribute('href', 'https://doluxoamesa.example.test');
  await expect(website).toHaveAttribute('target', '_blank');
});

test('the partner surface never mentions features that do not exist yet', async ({ page }) => {
  await page.goto('/partner');

  await expect(page.getByRole('heading', { name: /Olá/ })).toBeVisible();
  await expect(page.getByText(/Precisa da sua atenção/i)).toHaveCount(0);
  await expect(page.getByText(/Reportar um problema/i)).toHaveCount(0);
});

test('an unknown route offers a way back', async ({ page }) => {
  await page.goto('/partner/nada-aqui');
  await expect(page.getByRole('link', { name: /Voltar ao início/i })).toBeVisible();
});
