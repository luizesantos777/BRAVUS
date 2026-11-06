import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const admin = { Authorization: 'Bearer fixture_browser_admin_012345678901234567890123456789' };
const image = { name: 'print.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=', 'base64') };
async function account(page: Page, scenario: string, project: string) {
  const token = `fixture_${project}_${scenario}_01234567890123456789`, name = `Rascunho ${scenario} ${project}`;
  const response = await page.request.post('/api/admin/attendants', { headers: admin, data: { name, token } });
  expect(response.status()).toBe(201);
  return { token, name, id: (await response.json()).attendantId as string, headers: { Authorization: `Bearer ${token}` } };
}
async function fillSale(page: Page, amount = '197,31') {
  await page.getByLabel('Valor bruto venda 1', { exact: true }).fill(amount);
  await page.getByLabel('Checkout venda 1', { exact: true }).selectOption('buckpay');
  await page.getByLabel('Print da venda 1', { exact: true }).setInputFiles(image);
  await expect(page.locator('.draft-status')).toContainText('Rascunho salvo neste aparelho');
}

test('rascunho recupera campos e prints, separa vendedores e demonstração e permite descartar só o próprio rascunho', async ({ page }, info) => {
  const a = await account(page, 'restore_a', info.project.name), b = await account(page, 'restore_b', info.project.name);
  await page.goto(`/#/atendente/${a.token}`); await fillSale(page);
  await page.getByLabel('Data da Venda').fill('2025-01-10');
  await page.getByLabel('Horário venda 1', { exact: true }).fill('09:17');
  await page.getByLabel('Observação venda 1', { exact: true }).fill('Conferir amanhã');
  await page.getByRole('button', { name: 'Adicionar Outra Venda' }).click();
  await page.getByLabel('Valor bruto venda 2', { exact: true }).fill('80');
  await expect(page.locator('.draft-status')).toContainText('Rascunho salvo neste aparelho');
  await page.reload();
  await expect(page.locator('.draft-status')).toContainText('Rascunho recuperado');
  await expect(page.getByLabel('Data da Venda')).toHaveValue('2025-01-10');
  await expect(page.getByLabel('Horário venda 1', { exact: true })).toHaveValue('09:17');
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('197,31');
  await expect(page.getByLabel('Checkout venda 1', { exact: true })).toHaveValue('buckpay');
  await expect(page.getByLabel('Observação venda 1', { exact: true })).toHaveValue('Conferir amanhã');
  await expect(page.getByLabel('Valor bruto venda 2', { exact: true })).toHaveValue('80');
  await page.getByRole('button', { name: 'print.png', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Print do comprovante da venda' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await page.goto(`/#/atendente/${b.token}`);
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('');
  await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await fillSale(page, '100');
  await page.goto('/'); await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('');
  await page.goto(`/#/atendente/${a.token}`);
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('197,31');
  const stored = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('bravus-sales-drafts-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction(['drafts', 'receipts']);
      const keys = transaction.objectStore('drafts').getAllKeys(), drafts = transaction.objectStore('drafts').getAll(), receipts = transaction.objectStore('receipts').getAll();
      transaction.oncomplete = () => { resolve(JSON.stringify([keys.result, drafts.result, receipts.result])); db.close(); };
    };
  }));
  expect(stored).not.toContain(a.token); expect(stored).not.toContain(b.token); expect(stored).toContain(image.buffer.toString('base64'));
  await page.getByRole('button', { name: 'Descartar rascunho' }).click();
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue(''); await page.reload();
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toBeEnabled(); await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('');
  await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await page.goto(`/#/atendente/${b.token}`); await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('100');
  await expect(page.getByRole('button', { name: 'print.png', exact: true })).toBeVisible();
});

test('rascunho retoma uma resposta perdida após recarregar sem duplicar a venda recebida', async ({ page }, info) => {
  const a = await account(page, 'lost_response', info.project.name);
  const requests: { key: string; body: string | null }[] = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sales') requests.push({ key: request.headers()['idempotency-key'], body: request.postData() }); });
  await page.route('**/api/sales', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); });
  await page.goto(`/#/atendente/${a.token}`); await fillSale(page);
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar envio', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toBeDisabled();
  expect((await (await page.request.get('/api/portal?period=all', { headers: a.headers })).json()).sales).toHaveLength(1);
  await page.reload(); await expect(page.getByRole('button', { name: 'Confirmar envio', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('197,31');
  await page.unroute('**/api/sales');
  await page.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Enviada à administração');
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('');
  const portal = await (await page.request.get('/api/portal?period=all', { headers: a.headers })).json();
  expect(portal.sales).toHaveLength(1); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  await page.reload(); await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue(''); await expect(page.locator('.attachment-detail')).toHaveCount(0);
});

test('rascunho informa falha de armazenamento e não inicia envio até conseguir guardar os prints', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'denyDraftWrites', { value: true, writable: true });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'receipts' && (window as typeof window & { denyDraftWrites: boolean }).denyDraftWrites) throw new DOMException('fixture storage full', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  const a = await account(page, 'quota', info.project.name); let posts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sales') posts++; });
  await page.goto(`/#/atendente/${a.token}`);
  await page.getByLabel('Valor bruto venda 1', { exact: true }).fill('100'); await page.getByLabel('Checkout venda 1', { exact: true }).selectOption('buckpay');
  await page.getByLabel('Print da venda 1', { exact: true }).setInputFiles(image);
  await expect(page.locator('.draft-status')).toContainText('Não foi possível guardar o rascunho');
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas' }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível guardar o rascunho'); expect(posts).toBe(0);
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('100');
  await page.evaluate(() => { (window as typeof window & { denyDraftWrites: boolean }).denyDraftWrites = false; });
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas' }).click();
  await expect(page.getByRole('status')).toContainText('Enviada à administração'); expect(posts).toBe(1);
});

test('rascunho de outra aba não é sobrescrito por um preenchimento desatualizado', async ({ page, context }, info) => {
  const a = await account(page, 'two_tabs', info.project.name);
  await page.goto(`/#/atendente/${a.token}`); await fillSale(page);
  const second = await context.newPage(); await second.goto(`/#/atendente/${a.token}`);
  await expect(second.locator('.draft-status')).toContainText('Rascunho recuperado');
  await page.getByLabel('Valor bruto venda 1', { exact: true }).fill('198'); await expect(page.locator('.draft-status')).toContainText('Rascunho salvo');
  await second.getByLabel('Observação venda 1', { exact: true }).fill('Dados da outra aba');
  await expect(second.locator('.draft-status')).toContainText('alterado em outra aba');
  await page.reload(); await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('198');
  await expect(page.getByLabel('Observação venda 1', { exact: true })).toHaveValue('');
  await second.close();
});

test('comprovante repetido aparece na análise e na confirmação, deixando a decisão com o administrador', async ({ page }, info) => {
  const a = await account(page, 'original_proof', info.project.name), b = await account(page, 'repeated_proof', info.project.name);
  const base64 = await page.evaluate(label => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const c = canvas.getContext('2d')!; c.fillStyle = '#145f37'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#f9dc77'; c.font = '16px sans-serif'; c.fillText(label, 10, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  }, 'Comprovante ' + info.project.name);
  const portal = await (await page.request.get('/api/portal', { headers: a.headers })).json();
  await page.request.post('/api/sales', { headers: { ...a.headers, 'Idempotency-Key': 'fixture_original_proof_' + info.project.name }, data: { date: portal.today, sales: [{ amount: '100', checkoutId: 'buckpay', time: '12:00', note: '', receipt: { name: 'original.png', mime: 'image/png', base64 } }] } });
  const original = (await (await page.request.get('/api/portal', { headers: a.headers })).json()).sales[0];
  await page.request.patch('/api/admin/sales/' + original.id, { headers: admin, data: { status: 'approved', note: 'Conferida' } });
  await page.goto(`/#/atendente/${b.token}`);
  await page.getByLabel('Valor bruto venda 1', { exact: true }).fill('100'); await page.getByLabel('Checkout venda 1', { exact: true }).selectOption('buckpay');
  await page.getByLabel('Print da venda 1', { exact: true }).setInputFiles({ name: 'renomeado.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas' }).click(); await expect(page.getByRole('status')).toContainText('Enviada à administração');
  await page.goto('/#/admin'); await page.getByLabel('Chave administrativa').fill('fixture_browser_admin_012345678901234567890123456789'); await page.getByRole('button', { name: 'Entrar na administração' }).click();
  await page.getByLabel('Filtrar por atendente').selectOption(b.id);
  const warning = page.locator('.review-sale').getByLabel('Alerta de comprovante repetido'); await expect(warning).toContainText('1 outro(s)');
  await warning.getByRole('button', { name: 'Conferir lançamentos relacionados' }).click(); await expect(warning).toContainText(a.name); await expect(warning).toContainText('Aprovada');
  await page.getByRole('button', { name: 'Aprovar venda', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Aprovar venda', exact: true }); await expect(modal.getByLabel('Alerta de comprovante repetido')).toBeVisible();
  await modal.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.getByRole('button', { name: 'Recusar venda', exact: true }).click(); await page.getByLabel('Motivo da recusa', { exact: true }).fill('Mesmo comprovante de outra venda.');
  await page.getByRole('button', { name: 'Confirmar recusa', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Venda recusada');
  const result = await (await page.request.get('/api/portal', { headers: b.headers })).json(); expect(result.sales[0].status).toBe('rejected'); expect(result.finance.availableCents).toBe(0);
  expect((await (await page.request.get('/api/portal', { headers: a.headers })).json()).finance.availableCents).toBe(4566);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
