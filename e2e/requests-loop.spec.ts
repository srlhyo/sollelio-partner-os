/**
 * Slice 2 C3 through the real UI: return rounds and a lost answer.
 *
 * - Flow B: the partner answers, Sollelio returns one precise text question, the
 *   partner answers only that ("Falta só isto"), Sollelio reads the whole history
 *   and completes.
 * - Flow C: approval — "Precisa de alterações" with notes, returned for a new
 *   decision, approved, completed.
 * - Recovery: the answer to a submission is lost after the server stored it; trying
 *   again repeats the same attempt, and exactly one submission exists.
 *
 * Every Request is created and published through the real editor. Real stack, real
 * sessions (staff desktop, partner mobile), real RLS.
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

/** Creates and publishes a Request through the editor and the preview; returns its id. */
async function createAndPublish(page: Page, title: string, kind: 'question' | 'approval'): Promise<string> {
  await page.goto(`${ORG}/requests/new`);
  await page.getByLabel('Para quem').selectOption({ label: 'Nádia' });
  await page.getByLabel('Tipo', { exact: true }).selectOption({ label: kind === 'approval' ? 'Aprovação' : 'Pergunta' });
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('O que precisamos que faça').fill('Veja e diga-nos.');
  if (kind === 'question') {
    await page.getByRole('button', { name: 'Acrescentar pergunta' }).click();
    await page.getByLabel('Pergunta', { exact: true }).fill('O que correu mal?');
    await page.getByLabel('Tipo de resposta').selectOption({ label: 'Texto' });
  }
  await page.getByLabel('Critério de conclusão').fill('Sabemos o que mudar.');
  await page.getByRole('button', { name: 'Guardar e pré-visualizar' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}\/preview$/);
  const id = page.url().split('/').slice(-2)[0] ?? '';
  await page.getByRole('button', { name: 'Publicar para Nádia' }).click();
  await expect(page.getByText('Publicado. Nádia já vê o pedido.')).toBeVisible();
  return id;
}

async function returnToPartner(page: Page, id: string, message: string, kind: 'Texto' | 'Aprovação') {
  await page.goto(`${ORG}/requests/${id}`);
  await page.getByRole('button', { name: 'Devolver à parceira' }).click();
  await page.getByLabel(/O que ainda falta/).fill(message);
  await page.getByRole('radio', { name: kind }).check();
  await page.getByRole('button', { name: 'Devolver a Nádia' }).click();
  await expect(page.getByText(/Devolvido a Nádia/)).toBeVisible();
  await expect(page.getByText('Espera pela parceira').first()).toBeVisible();
}

async function complete(page: Page, id: string) {
  await page.goto(`${ORG}/requests/${id}`);
  await page.getByRole('button', { name: 'Concluir' }).click();
  await page.getByRole('button', { name: 'Confirmar conclusão' }).click();
  await expect(page.getByText('Pedido concluído.')).toBeVisible();
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('Flow B — returned with one text question, answered, full history, completed', async ({ browser, page }) => {
  const title = `Correu bem a importação? ${TAG}`;
  const id = await createAndPublish(page, title, 'question');

  const partner = await asPartner(browser);
  await partner.page.goto(`/partner/requests/${id}`);
  await partner.page.getByLabel('O que correu mal?').fill('A lista ficou com nomes repetidos.');
  await partner.page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(partner.page.getByText('Enviado. Já está connosco.')).toBeVisible();

  const question = 'Falta só confirmar se isto também acontece no telemóvel.';
  await returnToPartner(page, id, question, 'Texto');

  // Home says it needs her again, in plain words.
  await partner.page.goto('/partner');
  const card = partner.page.getByRole('link', { name: new RegExp(escaped(title)) });
  await expect(card).toContainText('Voltou a precisar de si');
  await card.click();

  // Only the new question; the original answer is there, read-only, for context.
  await expect(partner.page.getByText('Falta só isto')).toBeVisible();
  await expect(partner.page.getByText(question)).toBeVisible();
  await expect(partner.page.getByLabel('O que correu mal?')).toHaveCount(0);
  const previous = partner.page.getByRole('region', { name: 'A sua resposta anterior' });
  await expect(previous.getByText('A lista ficou com nomes repetidos.')).toBeVisible();
  await expect(partner.page.locator('textarea')).toHaveCount(1);
  await partner.page.getByLabel('A sua resposta', { exact: true }).fill('Sim, também no telemóvel.');
  await partner.page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(partner.page.getByText('Enviado. Já está connosco.')).toBeVisible();
  await expect(partner.page.getByText('Está com a Sollelio')).toBeVisible();
  await partner.close();

  // Sollelio reads the whole loop, in order, then completes.
  await page.goto(`${ORG}/requests/${id}`);
  const history = page.getByRole('region', { name: 'Respostas e devoluções' });
  const entries = history.getByRole('listitem');
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText('Resposta de Nádia');
  await expect(entries.nth(0)).toContainText('A lista ficou com nomes repetidos.');
  await expect(entries.nth(1)).toContainText('Devolvido à parceira');
  await expect(entries.nth(1)).toContainText(question);
  await expect(entries.nth(2)).toContainText('Sim, também no telemóvel.');
  await complete(page, id);

  // Two rounds, two submissions: the initial answer and the answer to the return.
  expect(sql(`select count(*) filter (where return_id is null) || '+' || count(*) filter (where return_id is not null)
                from public.request_submissions where request_id = '${id}'`)).toBe('1+1');
  expect(sql(`select status from public.requests where id = '${id}'`)).toBe('completed');
});

test('Flow C — approval: needs changes with notes, returned for a new decision, approved, completed', async ({ browser, page }) => {
  const title = `Aprova o novo cabeçalho? ${TAG}`;
  const id = await createAndPublish(page, title, 'approval');

  const partner = await asPartner(browser);
  await partner.page.goto(`/partner/requests/${id}`);
  await expect(partner.page.getByLabel(/O que deve mudar/)).toHaveCount(0);
  await partner.page.getByRole('radio', { name: 'Precisa de alterações' }).check();
  await partner.page.getByLabel(/O que deve mudar/).fill('Falta o logótipo.');
  await partner.page.getByRole('button', { name: 'Enviar decisão' }).click();
  await expect(partner.page.getByText('Enviado. Já está connosco.')).toBeVisible();

  await page.goto(`${ORG}/requests/${id}`);
  const history = page.getByRole('region', { name: 'Respostas e devoluções' });
  await expect(history.getByText('Precisa de alterações')).toBeVisible();
  await expect(history.getByText('Falta o logótipo.')).toBeVisible();
  await returnToPartner(page, id, 'Já pusemos o logótipo. Pode aprovar?', 'Aprovação');

  await partner.page.goto(`/partner/requests/${id}`);
  await expect(partner.page.getByText('Falta só isto')).toBeVisible();
  await expect(partner.page.getByText('Já pusemos o logótipo. Pode aprovar?')).toBeVisible();
  await partner.page.getByRole('radio', { name: 'Aprovar' }).check();
  await expect(partner.page.getByLabel(/O que deve mudar/)).toHaveCount(0);
  await partner.page.getByRole('button', { name: 'Enviar decisão' }).click();
  await expect(partner.page.getByText('Enviado. Já está connosco.')).toBeVisible();
  await partner.close();

  await page.goto(`${ORG}/requests/${id}`);
  await expect(page.getByRole('region', { name: 'Respostas e devoluções' }).getByRole('listitem')).toHaveCount(3);
  await complete(page, id);

  // The original approval field was never re-opened: the new decision lives in its round.
  expect(sql(`select response_decision from public.request_submissions where request_id = '${id}' and return_id is not null`)).toBe('approve');
  expect(sql(`select count(*) from public.request_fields where request_id = '${id}'`)).toBe('2');
});

test('Recovery — the answer is lost after the server stored it; trying again sends the same attempt', async ({ browser, page }) => {
  const id = await createAndPublish(page, `Resposta perdida ${TAG}`, 'question');
  const partner = await asPartner(browser);
  const p = partner.page;
  let lost = false;
  await p.route('**/functions/v1/partner-request-commands/submit', async (route) => {
    if (lost || route.request().method() !== 'POST') return route.fallback();
    lost = true;
    await route.fetch(); // the server receives and completes the submission
    await route.abort('failed'); // the browser never learns the outcome
  });

  await p.goto(`/partner/requests/${id}`);
  await p.getByLabel('O que correu mal?').fill('Nada, correu bem.');
  await p.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(p.getByText('Não sabemos se a sua resposta chegou.')).toBeVisible();
  expect(sql(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe('1');
  // The answers stay, locked, and no new attempt is offered while this one is unsettled.
  await expect(p.getByLabel('O que correu mal?')).toHaveValue('Nada, correu bem.');
  await expect(p.getByLabel('O que correu mal?')).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Enviar resposta' })).toHaveCount(0);

  await p.unroute('**/functions/v1/partner-request-commands/submit');
  await p.getByRole('button', { name: 'Tentar enviar de novo' }).click();
  await expect(p.getByText('Enviado. Já está connosco.')).toBeVisible();
  expect(sql(`select count(*) from public.request_submissions where request_id = '${id}'`)).toBe('1');
  expect(sql(`select count(*) from public.activity_events where object_id = '${id}' and event_type = 'request.submitted'`)).toBe('1');
  await partner.close();
});
