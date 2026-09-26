/**
 * Slice 2 C2 through the real UI: the operator (desktop) creates, edits, previews and
 * publishes a Request; the partner (mobile, her own session) reads it on Home and in
 * the detail, read-only. Real stack, real sessions, real RLS.
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
  // Nothing internal in the partner column, and nothing to answer with.
  await expect(frame.getByText('Respondeu e abriu o link canónico.')).toHaveCount(0);
  await expect(frame.locator('input, textarea, select, button')).toHaveCount(0);
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

test('the partner finds it on Home and reads it, with no answer control', async ({ browser }) => {
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
  await expect(page.getByText('O que vamos perguntar')).toBeVisible();
  await expect(page.getByText('Sim ou não')).toBeVisible();
  await expect(page.locator('input, textarea, select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Enviar|Responder|Submeter/i })).toHaveCount(0);
  await expect(page.getByText('Respondeu e abriu o link canónico.')).toHaveCount(0);
  await partner.close();
});

test('the partner detail states with Sollelio, done and cancelled', async ({ browser }) => {
  // No C2 command reaches these states; a privileged local update stands in for the
  // C3/C4 commands on this one Request.
  const partner = await asPartner(browser);
  const { page } = partner;
  sql(`update public.requests set status = 'needs_sollelio', next_actor = 'sollelio' where id = '${requestId}'`);
  await page.goto(`/partner/requests/${requestId}`);
  await expect(page.getByText('Está com a Sollelio')).toBeVisible();

  sql(`update public.requests set status = 'completed', next_actor = 'none', completed_at = now() where id = '${requestId}'`);
  await page.reload();
  await expect(page.getByText(/^Concluído/)).toBeVisible();

  sql(`update public.requests set status = 'cancelled', next_actor = 'none', cancelled_at = now() where id = '${requestId}'`);
  await page.reload();
  await expect(page.getByText(/A Sollelio cancelou este pedido/)).toBeVisible();

  await page.goto('/partner');
  await expect(page.getByRole('link', { name: TITLE_RE })).toHaveCount(0);
  await partner.close();
});

test('an id from elsewhere is not found inside this organization', async ({ page }) => {
  await page.goto(`${ORG}/requests/${randomUUID()}`);
  await expect(page.getByText('Não encontrámos este pedido.')).toBeVisible();
});
