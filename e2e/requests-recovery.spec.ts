/**
 * Slice 2 C2 — saving under slow, lost and refused responses, in a real browser
 * against the real local stack.
 *
 * "Lost after the server acted": the route handler forwards the request with
 * `route.fetch()` — the Edge Function and the database complete it — and only then
 * aborts, so the browser never sees the answer. Aborting before sending would not
 * test anything the server did.
 */
import { devices, expect, test, type Page } from '@playwright/test';
import { sql } from './helpers/requests';

test.describe.configure({ mode: 'serial' });

const ORG = '/app/organizations/do-luxo-a-mesa';
const TAG = Date.now().toString(36);
const TITLE = `Recuperação ${TAG}`;
let requestId = '';

async function loseResponseOnce(page: Page, action: string) {
  let done = false;
  await page.route(`**/functions/v1/request-commands/${action}`, async (route) => {
    if (done || route.request().method() !== 'POST') return route.fallback();
    done = true;
    await route.fetch(); // the server receives and completes the command
    await route.abort('failed'); // the browser never learns the outcome
  });
}

const count = (statement: string) => Number(sql(statement));

test('create: the answer is lost after the draft was created; verifying does not create it twice', async ({ page }) => {
  await page.goto(`${ORG}/requests/new`);
  await page.getByLabel('Para quem').selectOption({ label: 'Nádia' });
  await page.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Tarefa' });
  await page.getByLabel('Título').fill(TITLE);
  await page.getByLabel('O que precisamos que faça').fill('Confirme o horário.');
  await page.getByLabel('Critério de conclusão').fill('Confirmado.');

  await loseResponseOnce(page, 'create');
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByText('Não sabemos se a última gravação chegou ao servidor.')).toBeVisible();
  // The server did create it.
  expect(count(`select count(*) from public.requests where title = '${TITLE}'`)).toBe(1);

  await page.unroute('**/functions/v1/request-commands/create');
  await page.getByRole('button', { name: 'Verificar e guardar' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Rascunho guardado.')).toBeVisible();
  requestId = page.url().split('/').pop() ?? '';

  expect(count(`select count(*) from public.requests where title = '${TITLE}'`)).toBe(1);
  expect(count(`select count(*) from public.activity_events where object_id = '${requestId}' and event_type = 'request.created'`)).toBe(1);
});

test('update: the answer is lost after the edit landed; verifying recognises it and sends nothing again', async ({ page }) => {
  await page.goto(`${ORG}/requests/${requestId}`);
  await page.getByLabel('Título').fill(`${TITLE} v2`);
  await loseResponseOnce(page, 'update');
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByText('Não sabemos se a última gravação chegou ao servidor.')).toBeVisible();

  const landed = sql(`select title || '|' || revision from public.requests where id = '${requestId}'`);
  expect(landed.startsWith(`${TITLE} v2|`)).toBe(true);

  await page.unroute('**/functions/v1/request-commands/update');
  await page.getByRole('button', { name: 'Verificar e guardar' }).click();
  await expect(page.getByText('Rascunho guardado.')).toBeVisible();
  await expect(page.getByText('Este rascunho foi alterado noutra sessão.')).toHaveCount(0);
  // Same revision as right after the lost update: it was not applied a second time.
  expect(sql(`select title || '|' || revision from public.requests where id = '${requestId}'`)).toBe(landed);
});

test('a change from another session is never overwritten without a choice', async ({ page }) => {
  await page.goto(`${ORG}/requests/${requestId}`);
  await page.getByLabel('Título').fill(`${TITLE} minha versão`);
  sql(`update public.requests set title = '${TITLE} outra sessão' where id = '${requestId}'`); // the other session
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();

  await expect(page.getByText('Este rascunho foi alterado noutra sessão.')).toBeVisible();
  await expect(page.getByLabel('Título')).toHaveValue(`${TITLE} minha versão`); // local work kept
  expect(sql(`select title from public.requests where id = '${requestId}'`)).toBe(`${TITLE} outra sessão`);

  await page.getByRole('button', { name: 'Ver a versão guardada (descarta este formulário)' }).click();
  await expect(page.getByLabel('Título')).toHaveValue(`${TITLE} outra sessão`);
});

test('publish: the answer is lost after publication; verifying repeats the same attempt, not a new one', async ({ page }) => {
  await page.goto(`${ORG}/requests/${requestId}/preview`);
  await loseResponseOnce(page, 'publish');
  await page.getByRole('button', { name: 'Publicar para Nádia' }).click();
  await expect(page.getByText('Não sabemos se o pedido foi publicado.')).toBeVisible();
  expect(sql(`select status from public.requests where id = '${requestId}'`)).toBe('needs_partner');
  // No new attempt is offered while this one is unresolved.
  await expect(page.getByRole('button', { name: 'Publicar para Nádia' })).toHaveCount(0);

  await page.unroute('**/functions/v1/request-commands/publish');
  await page.getByRole('button', { name: 'Verificar e repetir' }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestId}$`));
  await expect(page.getByText('Publicado. Nádia já vê o pedido.')).toBeVisible();
  expect(count(`select count(*) from public.activity_events where object_id = '${requestId}' and event_type = 'request.published'`)).toBe(1);
});

test('the form is locked for as long as the server takes to answer', async ({ page }) => {
  await page.goto(`${ORG}/requests/new`);
  await page.getByLabel('Para quem').selectOption({ label: 'Nádia' });
  await page.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Tarefa' });
  await page.getByLabel('Título').fill(`Lento ${TAG}`);
  await page.getByLabel('O que precisamos que faça').fill('x');

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/functions/v1/request-commands/create', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByLabel('Título')).toBeDisabled();
  await expect(page.getByLabel('O que precisamos que faça')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'A guardar…' }).first()).toBeDisabled();
  await expect(page.getByText('A guardar… o formulário fica bloqueado até o servidor confirmar.')).toBeVisible();
  release();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  expect(count(`select count(*) from public.requests where title = 'Lento ${TAG}'`)).toBe(1);
});

test('a gateway 401 (not the function’s error shape) offers sign-in back to this page', async ({ page }) => {
  await page.goto(`${ORG}/requests/new`);
  await page.getByLabel('Para quem').selectOption({ label: 'Nádia' });
  await page.getByLabel('Título').fill(`Sessão ${TAG}`);
  await page.getByLabel('O que precisamos que faça').fill('x');
  await page.route('**/functions/v1/request-commands/create', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ msg: 'Invalid JWT' }) })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByText('A sua sessão terminou.')).toBeVisible();
  await expect(page.getByText(/perdem-se ao sair desta página/)).toBeVisible();
  const link = page.getByRole('link', { name: 'Entrar de novo' });
  await expect(link).toHaveAttribute('href', `/partner/sign-in?redirectTo=${encodeURIComponent(`${ORG}/requests/new`)}`);
  expect(count(`select count(*) from public.requests where title = 'Sessão ${TAG}'`)).toBe(0);
});

for (const timezoneId of ['America/Sao_Paulo', 'Europe/Lisbon']) {
  test(`deadlines are Lisbon days with the browser in ${timezoneId}, and survive open-and-save unchanged`, async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Desktop Chrome'], timezoneId, storageState: '.auth/staff.json' });
    const page = await context.newPage();
    const title = `Prazo ${timezoneId} ${TAG}`;
    await page.goto(`${ORG}/requests/new`);
    await page.getByLabel('Para quem').selectOption({ label: 'Nádia' });
    await page.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Tarefa' });
    await page.getByLabel('Título').fill(title);
    await page.getByLabel('O que precisamos que faça').fill('x');
    await expect(page.getByText(/hora de Lisboa/)).toBeVisible();
    await page.getByLabel('Prazo').fill('2026-10-25'); // the autumn change: winter time, UTC+0 in Lisbon
    await page.getByRole('button', { name: 'Guardar rascunho' }).click();
    await expect(page.getByText('Rascunho guardado.')).toBeVisible();
    const id = page.url().split('/').pop() ?? '';
    const stored = sql(`select to_char(due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') from public.requests where id = '${id}'`);
    expect(stored).toBe('2026-10-25T23:59:59');

    // A deadline written at another time of day (e.g. by an earlier tool) is kept
    // exactly when the operator opens and saves without touching it.
    sql(`update public.requests set due_at = '2026-07-15T02:00:00Z' where id = '${id}'`);
    await page.reload();
    await expect(page.getByLabel('Prazo')).toHaveValue('2026-07-15'); // 03:00 in Lisbon; 23:00 on the 14th in São Paulo
    await page.getByRole('button', { name: 'Guardar rascunho' }).click();
    await expect(page.getByText('Rascunho guardado.')).toBeVisible();
    expect(sql(`select to_char(due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') from public.requests where id = '${id}'`)).toBe('2026-07-15T02:00:00');
    await context.close();
  });
}
