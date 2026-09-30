/**
 * Slice 2 C4 through the real UI: cancelling a Request.
 *
 * - Flow A: a draft is cancelled from the editor; nothing is editable afterwards and
 *   the partner never sees it.
 * - Flow B: a published Request the partner has to act on is cancelled; it leaves
 *   "Precisa de si" and the partner reads that it was cancelled, and why.
 * - Flow C: the partner answered; Sollelio cancels while it waits on Sollelio; the
 *   partner sees the cancellation and the reason, and her answer is still there.
 *
 * Real stack, real sessions (staff desktop, partner mobile), real RLS.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { sql } from './helpers/requests';

test.describe.configure({ mode: 'serial' });

const ORG = '/app/organizations/do-luxo-a-mesa';
const TAG = Date.now().toString(36);

async function asPartner(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ ...devices['Pixel 7'], storageState: '.auth/partner.json' });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

async function fillEditor(page: Page, title: string) {
  await page.goto(`${ORG}/requests/new`);
  await page.getByLabel('Para quem').selectOption({ label: 'Nádia' });
  await page.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Pergunta' });
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('O que precisamos que faça').fill('Veja e diga-nos.');
  await page.getByRole('button', { name: 'Acrescentar pergunta' }).click();
  await page.getByLabel('Pergunta', { exact: true }).fill('O que correu mal?');
  await page.getByLabel('Tipo de resposta').selectOption({ label: 'Texto' });
  await page.getByLabel('Critério de conclusão').fill('Sabemos o que mudar.');
}

async function createAndPublish(page: Page, title: string): Promise<string> {
  await fillEditor(page, title);
  await page.getByRole('button', { name: 'Guardar e pré-visualizar' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}\/preview$/);
  const id = page.url().split('/').slice(-2)[0] ?? '';
  await page.getByRole('button', { name: 'Publicar para Nádia' }).click();
  await expect(page.getByText('Publicado. Nádia já vê o pedido.')).toBeVisible();
  return id;
}

/** Cancels from the page already open, through the confirmation panel. */
async function cancelHere(page: Page, reason: string) {
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByText(/O cancelamento é definitivo/)).toBeVisible();
  // Never one click, never without a reason.
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Escreva o motivo do cancelamento.')).toBeVisible();
  await page.getByLabel('Motivo do cancelamento').fill(reason);
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Pedido cancelado.')).toBeVisible();
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('Flow A — a draft is cancelled from the editor and never reaches the partner', async ({ browser, page }) => {
  const title = `Rascunho a cancelar ${TAG}`;
  await fillEditor(page, title);
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByText('Rascunho guardado.')).toBeVisible();
  const id = page.url().split('/').pop() ?? '';
  await expect(page.getByText(/Este rascunho nunca foi publicado/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByText(/Este rascunho nunca foi publicado/)).toBeVisible();
  await page.getByRole('button', { name: 'Manter pedido' }).click();
  await cancelHere(page, 'Afinal tratámos disto por telefone.');

  // Now a closed Request: its reason, and nothing to edit, publish or cancel.
  await expect(page.getByText(/^Cancelado a /)).toBeVisible();
  await expect(page.getByText('Afinal tratámos disto por telefone.')).toBeVisible();
  await expect(page.getByText(/Era um rascunho: a parceira nunca o viu/)).toBeVisible();
  await expect(page.getByText('Cancelou o pedido')).toBeVisible();
  for (const name of ['Guardar rascunho', 'Guardar e pré-visualizar', 'Cancelar pedido', 'Concluir', 'Devolver à parceira']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await page.goto(`${ORG}/requests/${id}/preview`);
  await expect(page.getByRole('button', { name: 'Publicar para Nádia' })).toHaveCount(0);
  expect(sql(`select status || '/' || (published_at is null) from public.requests where id = '${id}'`)).toBe('cancelled/true');

  const partner = await asPartner(browser);
  await partner.page.goto(`/partner/requests/${id}`);
  await expect(partner.page.getByText('Não conseguimos abrir este pedido.')).toBeVisible();
  await expect(partner.page.getByText(title)).toHaveCount(0);
  await partner.page.goto('/partner');
  await expect(partner.page.getByRole('heading', { name: 'Precisa de si' })).toBeVisible();
  await expect(partner.page.getByText(title)).toHaveCount(0);
  await partner.close();
});

test('Flow B — cancelled while waiting on the partner: it leaves "Precisa de si" and says why', async ({ browser, page }) => {
  const title = `Pedido que deixou de ser preciso ${TAG}`;
  const id = await createAndPublish(page, title);

  const partner = await asPartner(browser);
  await partner.page.goto('/partner');
  const attention = partner.page.locator('section.attn');
  await expect(attention.getByRole('link', { name: new RegExp(escaped(title)) })).toBeVisible();

  await page.goto(`${ORG}/requests/${id}`);
  await expect(page.getByText('Espera pela parceira').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByText(/Nádia deixa de o ver em “Precisa de si” e lê o motivo/)).toBeVisible();
  await page.getByRole('button', { name: 'Manter pedido' }).click();
  const reason = 'O evento foi adiado para o próximo ano.';
  await cancelHere(page, reason);
  await expect(page.getByText(/A parceira vê este motivo no pedido/)).toBeVisible();
  await expect(page.getByText('Cancelou o pedido')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);

  await partner.page.reload();
  await expect(partner.page.getByRole('heading', { name: 'Precisa de si' })).toBeVisible();
  await expect(attention.getByRole('link', { name: new RegExp(escaped(title)) })).toHaveCount(0);

  await partner.page.goto(`/partner/requests/${id}`);
  await expect(partner.page.getByText('Este pedido foi cancelado pela Sollelio.')).toBeVisible();
  await expect(partner.page.getByText(reason)).toBeVisible();
  await expect(partner.page.getByText('Já não precisa de fazer nada aqui.')).toBeVisible();
  await expect(partner.page.getByRole('button', { name: /Enviar/ })).toHaveCount(0);
  await expect(partner.page.getByLabel('O que correu mal?')).toHaveCount(0);
  await partner.close();
});

test('Flow C — the partner answered; cancelled while with Sollelio, her answer is still there', async ({ browser, page }) => {
  const title = `Pedido respondido e cancelado ${TAG}`;
  const id = await createAndPublish(page, title);
  const answer = 'A lista ficou com nomes repetidos.';

  const partner = await asPartner(browser);
  await partner.page.goto(`/partner/requests/${id}`);
  await partner.page.getByLabel('O que correu mal?').fill(answer);
  await partner.page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(partner.page.getByText('Enviado. Já está connosco.')).toBeVisible();

  await page.goto(`${ORG}/requests/${id}`);
  await expect(page.getByText('Espera pela Sollelio').first()).toBeVisible();
  const reason = 'Resolvemos isto de outra forma com a equipa.';
  await cancelHere(page, reason);
  // The history is untouched: the partner's answer is still read here.
  const history = page.getByRole('region', { name: 'Respostas e devoluções' });
  await expect(history.getByText(answer)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Concluir' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Devolver à parceira' })).toHaveCount(0);

  await partner.page.goto(`/partner/requests/${id}`);
  await expect(partner.page.getByText('Este pedido foi cancelado pela Sollelio.')).toBeVisible();
  await expect(partner.page.getByText(reason)).toBeVisible();
  await expect(partner.page.getByText(answer)).toBeVisible();
  await expect(partner.page.getByRole('button', { name: /Enviar/ })).toHaveCount(0);
  expect(sql(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe('1');
  await partner.close();
});
