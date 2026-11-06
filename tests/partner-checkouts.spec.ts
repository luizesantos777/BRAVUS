import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const image = { name: 'parceiro.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=', 'base64') };
async function changeStoredCheckout(page: Page, pending: boolean) {
  await page.evaluate(pending => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('bravus-sales-drafts-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('drafts', 'readwrite');
      const cursor = transaction.objectStore('drafts').openCursor();
      cursor.onsuccess = () => { const row = cursor.result!; const draft = row.value; draft.pending = pending; draft.rows[0].checkoutId = 'main'; row.update(draft); };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), pending);
}
test('parceiro vê um único gateway de 10%, recupera rascunho e os outros vendedores conservam suas opções', async ({ page }, info) => {
  const token = `fixture_${info.project.name}_exclusive_01234567890123456789`, headers = { Authorization: `Bearer ${token}` };
  const portal = await (await page.request.get('/api/portal', { headers })).json(), id = portal.checkouts[0].id;
  await page.goto(`/#/atendente/${token}`);
  const select = page.getByLabel('Checkout venda 1', { exact: true });
  await expect(select).toHaveValue(id); await expect(select.locator('option:not([disabled])')).toHaveCount(1);
  await expect(page.locator('.checkout-tariff')).toContainText('10,00%'); await expect(page.locator('.checkout-tariff')).toContainText('0,00');
  await expect(page.locator('.manual-pix-card')).toHaveCount(0);
  await page.getByLabel('Valor bruto venda 1', { exact: true }).fill('100');
  await page.getByLabel('Print da venda 1', { exact: true }).setInputFiles(image);
  await expect(page.locator('.draft-status')).toContainText('Rascunho salvo');
  await changeStoredCheckout(page, false); await page.reload();
  await expect(select).toHaveValue(id); await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('100');
  await expect(page.getByRole('button', { name: 'parceiro.png', exact: true })).toBeVisible();
  await expect(page.getByLabel('Taxas da venda 1')).toContainText('10,00'); await expect(page.getByLabel('Taxas da venda 1')).toContainText('45,00');
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas' }).click(); await expect(page.getByRole('status')).toContainText('Enviada à administração');
  const result = await (await page.request.get('/api/portal?period=all', { headers })).json();
  expect(result.sales).toHaveLength(1); expect(result.sales[0].checkoutId).toBe(id); expect(result.sales[0].feeCents).toBe(1000); expect(result.sales[0].attendantFeeCents).toBe(500);
  const normal = `fixture_${info.project.name}_primary_01234567890123456789`;
  await page.goto(`/#/atendente/${normal}`);
  await expect(select.locator('option:not([disabled])')).toHaveCount(3); await expect(page.locator('.manual-pix-card')).toBeVisible();
  await page.goto(`/#/atendente/${token}`); await expect(select).toHaveValue(id); await expect(select.locator('option:not([disabled])')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('confirmação de rascunho antigo conserva o envio original e troca o gateway só após resposta do servidor', async ({ page }, info) => {
  const token = `fixture_${info.project.name}_exclusive_resume_01234567890123456789`, headers = { Authorization: `Bearer ${token}` };
  const portal = await (await page.request.get('/api/portal', { headers })).json(), id = portal.checkouts[0].id;
  const requests: { key: string; checkout: string }[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sales') requests.push({ key: request.headers()['idempotency-key'], checkout: request.postDataJSON().sales[0].checkoutId }); });
  await page.goto(`/#/atendente/${token}`);
  await page.getByLabel('Valor bruto venda 1', { exact: true }).fill('100'); await page.getByLabel('Print da venda 1', { exact: true }).setInputFiles(image);
  await expect(page.locator('.draft-status')).toContainText('Rascunho salvo');
  await changeStoredCheckout(page, true); await page.reload();
  await expect(page.getByRole('button', { name: 'Confirmar envio', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Checkout venda 1', { exact: true })).toHaveValue('main');
  await page.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Selecione um checkout válido');
  await expect(page.getByLabel('Checkout venda 1', { exact: true })).toHaveValue(id);
  expect((await (await page.request.get('/api/portal', { headers })).json()).sales).toHaveLength(0);
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas' }).click(); await expect(page.getByRole('status')).toContainText('Enviada à administração');
  expect(requests.map(request => request.checkout)).toEqual(['main', id]); expect(requests[1].key).toBe(requests[0].key);
  const result = await (await page.request.get('/api/portal', { headers })).json(); expect(result.sales).toHaveLength(1); expect(result.sales[0].feeCents).toBe(1000);
});
