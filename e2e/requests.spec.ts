/**
 * Slice 2 through the real UI (Flow A): the operator (desktop) creates, edits,
 * previews and publishes a Request (C2); the partner (mobile, her own session) finds
 * it on Home and answers it; the operator reads the exact response and completes it;
 * the partner sees it done (C3). Real stack, real sessions, real RLS.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { sql } from './helpers/requests';

test.describe.configure({ mode: 'serial' });

const ORG = '/app/organizations/do-luxo-a-mesa';
const TITLE = `Os endereços foram fáceis de encontrar? ${Date.now().toString(36)}`;
let requestId = '';

/** The title, as a literal inside a RegExp (it contains “?”). */
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TITLE_RE = new RegExp(escaped(TITLE));

async function asPartner(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ ...devices['Pixel 7'], storageState: '.auth/partner.json' });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test('an incomplete draft is not saved, and the operator is told exactly what is missing', async ({ page }) => {
  await page.goto(`${ORG}/requests`);
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Novo pedido' }).click();
  await expect(page).toHaveURL(/\/requests\/new$/);

  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  const summary = page.getByRole('alert');
  await expect(summary).toContainText('Há campos a corrigir.');
  await expect(summary.getByRole('link', { name: 'Escreva um título.' })).toBeVisible();
  // The summary takes focus so a keyboard user lands on it.
  await expect(page.locator(':focus')).toContainText('Há campos a corrigir.');
  await expect(page.getByLabel('Título')).toHaveAttribute('aria-invalid', 'true');
});

test('the operator creates a draft, edits it and opens the preview', async ({ page }) => {
  await page.goto(`${ORG}/requests/new`);
  await page.getByLabel('Para quem').selectOption({ label: 'Nádia' });
  await page.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Pergunta' });
  await page.getByLabel('Título').fill(TITLE);
  await page.getByLabel('O que precisamos que faça').fill('Abra o Sollelio Events a partir de “Acesso rápido”, volte aqui e diga-nos se foi óbvio.');
  await page.getByLabel(/Recurso associado/).selectOption({ label: 'Sollelio Events · events.example.test' });
  await page.getByRole('button', { name: 'Acrescentar pergunta' }).click();
  await page.getByLabel('Pergunta', { exact: true }).fill('Foi fácil encontrar o que precisava?');
  await page.getByLabel('Tipo de resposta').selectOption({ label: 'Sim / Não' });
  await page.getByLabel('Critério de conclusão').fill('Respondeu e abriu o link canónico.');
  // ~3 min is the default preset: the onboarding baseline.
  await expect(page.getByRole('radio', { name: '~3 min' })).toBeChecked();

  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Rascunho guardado.')).toBeVisible();
  requestId = page.url().split('/').pop() ?? '';

  await page.getByLabel('Título').fill(`${TITLE} (revisto)`);
  await page.getByRole('button', { name: 'Guardar e pré-visualizar' }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestId}/preview$`));

  const frame = page.getByLabel('Como Nádia vê o pedido');
  await expect(frame.getByRole('heading', { name: `${TITLE} (revisto)` })).toBeVisible();
  await expect(frame.getByText('~3 min')).toBeVisible();
  await expect(frame.getByText('Foi fácil encontrar o que precisava?')).toBeVisible();
  await expect(frame.getByRole('link', { name: /Sollelio Events/ })).toBeVisible();
  // Nothing internal in the partner column. The partner's real controls are shown,
  // but none of them can be used from the preview (03_UX_SPEC.md §16).
  await expect(frame.getByText('Respondeu e abriu o link canónico.')).toHaveCount(0);
  await expect(frame.getByRole('radio', { name: 'Sim' })).toBeDisabled();
  await expect(frame.getByRole('radio', { name: 'Não' })).toBeDisabled();
  await expect(frame.getByRole('button', { name: 'Enviar resposta' })).toBeDisabled();
  await expect(frame.locator('input:enabled, textarea:enabled, select:enabled, button:enabled')).toHaveCount(0);
  await expect(page.getByText('Critério de conclusão definido (só Sollelio).')).toBeVisible();
});

test('a draft is invisible to the partner, exactly like a Request that does not exist', async ({ browser }) => {
  const partner = await asPartner(browser);
  await partner.page.goto(`/partner/requests/${requestId}`);
  await expect(partner.page.getByText('Não conseguimos abrir este pedido.')).toBeVisible();
  await partner.page.goto(`/partner/requests/${randomUUID()}`);
  await expect(partner.page.getByText('Não conseguimos abrir este pedido.')).toBeVisible();
  await partner.page.goto('/partner');
  await expect(partner.page.getByRole('link', { name: TITLE_RE })).toHaveCount(0);
  await partner.close();
});

test('the operator publishes the previewed version', async ({ page }) => {
  await page.goto(`${ORG}/requests/${requestId}/preview`);
  await page.getByRole('button', { name: 'Publicar para Nádia' }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestId}$`));
  await expect(page.getByText('Publicado. Nádia já vê o pedido.')).toBeVisible();
  await expect(page.getByText('Espera pela parceira').first()).toBeVisible();
  await expect(page.getByText('Respondeu e abriu o link canónico.')).toBeVisible();
  await expect(page.getByText('Publicou o pedido')).toBeVisible();

  await page.goto(`${ORG}/requests`);
  await expect(page.getByRole('link', { name: TITLE_RE })).toBeVisible();
});

test('the partner finds it on Home and answers it', async ({ browser }) => {
  const partner = await asPartner(browser);
  const { page } = partner;
  await page.goto('/partner');
  const attention = page.getByRole('region', { name: 'Precisa de si' });
  await expect(attention).toBeVisible();
  const card = attention.getByRole('link', { name: TITLE_RE });
  await expect(card).toBeVisible();
  await expect(card).toContainText('~3 min');
  // Home still offers the Slice 1 canonical links.
  await expect(page.getByRole('heading', { name: 'Acesso rápido' })).toBeVisible();

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/partner/requests/${requestId}$`));
  await expect(page.getByRole('heading', { name: `${TITLE} (revisto)` })).toBeVisible();
  await expect(page.getByText('Respondeu e abriu o link canónico.')).toHaveCount(0);

  // Real controls. `Não` is a real answer, not a missing one.
  await page.getByRole('radio', { name: 'Não' }).check();
  await page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(page.getByText('Enviado. Já está connosco.')).toBeVisible();
  await expect(page.getByText('Está com a Sollelio')).toBeVisible();
  const mine = page.getByRole('region', { name: 'A sua resposta' });
  await expect(mine.getByText('Foi fácil encontrar o que precisava?')).toBeVisible();
  await expect(mine.getByText('Não', { exact: true })).toBeVisible();
  await expect(page.locator('input, textarea')).toHaveCount(0);
  expect(sql(`select count(*) from public.request_submissions where request_id = '${requestId}'`)).toBe('1');

  // Home no longer counts it: read again from the server.
  await page.goto('/partner');
  await expect(page.getByRole('link', { name: TITLE_RE })).toHaveCount(0);
  await partner.close();
});

test('the operator reads the exact response and completes; the partner sees it done', async ({ browser, page }) => {
  await page.goto(`${ORG}/requests/${requestId}`);
  await expect(page.getByText('Espera pela Sollelio').first()).toBeVisible();
  const history = page.getByRole('region', { name: 'Respostas e devoluções' });
  await expect(history.getByText(/Resposta de Nádia/)).toBeVisible();
  await expect(history.getByText('Foi fácil encontrar o que precisava?')).toBeVisible();
  await expect(history.getByText('Não', { exact: true })).toBeVisible();
  await expect(page.getByText('Respondeu ao pedido')).toBeVisible();

  await page.getByRole('button', { name: 'Concluir' }).click();
  await page.getByRole('button', { name: 'Confirmar conclusão' }).click();
  await expect(page.getByText('Pedido concluído.')).toBeVisible();
  await expect(page.getByText('Concluído').first()).toBeVisible();
  await expect(page.getByText('Concluiu o pedido')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Concluir' })).toHaveCount(0);

  const partner = await asPartner(browser);
  await partner.page.goto(`/partner/requests/${requestId}`);
  await expect(partner.page.getByText(/^Concluído/)).toBeVisible();

  // No C3 command reaches "cancelled" (cancellation is a later checkpoint); a
  // privileged local update stands in for it, on this one Request only.
  sql(`update public.requests set status = 'cancelled', next_actor = 'none', cancelled_at = now() where id = '${requestId}'`);
  await partner.page.reload();
  await expect(partner.page.getByText(/A Sollelio cancelou este pedido/)).toBeVisible();
  await partner.close();
});

test('an id from elsewhere is not found inside this organization', async ({ page }) => {
  await page.goto(`${ORG}/requests/${randomUUID()}`);
  await expect(page.getByText('Não encontrámos este pedido.')).toBeVisible();
});
