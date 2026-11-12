import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pdfReceiptBytes } from './pdf-fixture.ts';

const adminKey = 'fixture_browser_admin_012345678901234567890123456789';
const admin = { Authorization: `Bearer ${adminKey}` };
const bytes = pdfReceiptBytes();
const pdf = { name: 'comprovante-banco.pdf', mimeType: 'application/pdf', buffer: bytes };

for (const kind of ['partner', 'attendant']) test(`${kind}: botão PDF, rascunho, envio e comprovante original no admin`, async ({ page }, info) => {
  const token = `fixture_pdf_${kind}_${info.project.name}_01234567890123456789`, name = `PDF ${kind} ${info.project.name}`, personal = { Authorization: `Bearer ${token}` };
  const created = await page.request.post('/api/admin/attendants', { headers: admin, data: { name, token, accountKind: kind } });expect(created.status()).toBe(201);const { attendantId } = await created.json();
  const errors: string[] = [];page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/#/atendente/${token}`);await page.getByLabel('Valor bruto venda 1', { exact: true }).fill('100');
  if (kind === 'attendant') await page.getByLabel('Checkout venda 1', { exact: true }).selectOption('main');
  const chooser = page.waitForEvent('filechooser');await page.getByRole('button', { name: 'Anexar PDF venda 1', exact: true }).click();await (await chooser).setFiles(pdf);
  await expect(page.getByRole('button', { name: 'Anexar PDF venda 1', exact: true })).toHaveText('PDF anexado');
  await expect(page.getByRole('button', { name: 'Anexar print venda 1', exact: true })).toHaveText('Anexar Print *');
  await page.getByRole('button', { name: pdf.name, exact: true }).click();
  const group = page.getByRole('group', { name: 'Comprovante em PDF', exact: true });await expect(group).toBeVisible();await expect(group.locator('img')).toHaveCount(0);
  await expect(group.getByRole('link', { name: 'Abrir PDF', exact: true })).toHaveAttribute('href', /^blob:/);await expect(group.getByRole('link', { name: 'Abrir PDF', exact: true })).toHaveAttribute('target', '_blank');
  const download = page.waitForEvent('download');await group.getByRole('link', { name: 'Baixar PDF', exact: true }).click();expect(await readFile((await (await download).path())!)).toEqual(bytes);
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();await expect(page.locator('.draft-status')).toContainText('Rascunho salvo');
  await page.reload();await expect(page.getByRole('button', { name: pdf.name, exact: true })).toBeVisible();await expect(page.getByRole('button', { name: 'Anexar PDF venda 1', exact: true })).toHaveText('PDF anexado');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);await page.screenshot({ path: info.outputPath(`anexar-pdf-${kind}.png`), fullPage: true });
  if (kind === 'partner') {
    let first = true;
    await page.route('**/api/sales', async route => { const response = await route.fetch();if (first) { first = false;await route.abort('failed'); } else await route.fulfill({ response }); });
  }
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas', exact: true }).click();
  if (kind === 'partner') {
    await expect(page.getByRole('button', { name: 'Confirmar envio', exact: true })).toBeEnabled();await expect(page.getByRole('button', { name: 'Anexar PDF venda 1', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Confirmar envio', exact: true }).click();
  }
  await expect(page.getByRole('status')).toContainText('Enviada à administração');
  const portal = await (await page.request.get('/api/portal?period=all', { headers: personal })).json();expect(portal.sales).toHaveLength(1);
  const response = await page.request.get(`/api/receipts/${portal.sales[0].receiptId}`, { headers: personal });expect(response.headers()['content-type']).toBe('application/pdf');expect(await response.body()).toEqual(bytes);
  await page.getByRole('button', { name: /Ver comprovante da venda de/ }).click();await expect(group).toBeVisible();await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  await page.goto('/#/admin');await page.getByLabel('Chave administrativa', { exact: true }).fill(adminKey);await page.getByRole('button', { name: 'Entrar na administração', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filtrar por atendente', exact: true }).selectOption(attendantId);await expect(page.locator('.review-sale')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ver comprovante', exact: true }).click();await expect(group).toBeVisible();await expect(page.getByRole('img', { name: 'Comprovante da venda', exact: true })).toHaveCount(0);
  const adminDownload = page.waitForEvent('download');await group.getByRole('link', { name: 'Baixar PDF', exact: true }).click();expect(await readFile((await (await adminDownload).path())!)).toEqual(bytes);
  await page.screenshot({ path: info.outputPath(`pdf-admin-${kind}.png`), fullPage: true });await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  await page.getByRole('button', { name: 'Aprovar venda', exact: true }).click();await page.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();await expect(page.locator('.review-sale')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PDF inválido ou grande não reutiliza o anexo anterior; PDF também funciona na demonstração', async ({ page }) => {
  await page.goto('/');await page.getByLabel('Valor bruto venda 1', { exact: true }).fill('100');await page.getByLabel('Checkout venda 1', { exact: true }).selectOption('main');
  const input = page.getByLabel('PDF da venda 1', { exact: true });
  await input.setInputFiles({ ...pdf, mimeType: '' });await expect(page.locator('.attachment-detail')).toContainText(pdf.name);
  await input.setInputFiles({ ...pdf, buffer: Buffer.from('<html>não é PDF</html>') });await expect(page.locator('.attachment-error')).toContainText('PDF está inválido');await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await input.setInputFiles({ ...pdf, buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32) });await expect(page.locator('.attachment-error')).toContainText('PDF de até 2 MB');
  await input.setInputFiles({ ...pdf, buffer: Buffer.alloc(0) });await expect(page.locator('.attachment-error')).toContainText('PDF está vazio');
  await input.setInputFiles(pdf);await expect(page.locator('.attachment-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remover PDF venda 1', exact: true }).click();await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await input.setInputFiles(pdf);await page.getByRole('button', { name: 'Salvar e Enviar Vendas', exact: true }).click();await expect(page.getByRole('status')).toContainText('Demonstração');
  await page.getByRole('button', { name: /Ver comprovante da venda de/ }).click();await expect(page.getByRole('group', { name: 'Comprovante em PDF', exact: true })).toBeVisible();
});
