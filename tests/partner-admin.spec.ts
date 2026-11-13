import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const adminKey = 'fixture_browser_admin_012345678901234567890123456789';
const admin = { Authorization: `Bearer ${adminKey}` };
const receipt = { name: 'venda219.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' };
async function fixture(page: Page, info: TestInfo, scenario: string) {
  const name = `Parceiro ${scenario} ${info.project.name}`, token = `fixture_partner_admin_${scenario}_${info.project.name}_01234567890123456789`;
  const response = await page.request.post('/api/admin/attendants', { headers: admin, data: { name, accountKind: 'partner', token } });expect(response.status()).toBe(201);
  const created = await response.json(), personal = { Authorization: `Bearer ${token}` };
  const initial = await (await page.request.get('/api/portal', { headers: personal })).json();
  const sale = await page.request.post('/api/sales', { headers: { ...personal, 'Idempotency-Key': `fixture_partner_admin_sale_${scenario}_${info.project.name}` }, data: { date: initial.today, sales: [{ amount: '219', time: '12:00', note: '', receipt }] } });expect(sale.status()).toBe(200);
  const own = await (await page.request.get('/api/portal', { headers: personal })).json();
  await page.goto('/#/admin');await page.getByLabel('Chave administrativa').fill(adminKey);await page.getByRole('button', { name: 'Entrar na administração', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visão administrativa', exact: true })).toBeVisible();
  return { name, token, id: created.attendantId as string, saleId: own.sales[0].id as string, today: initial.today as string, personal };
}

test('venda do parceiro mostra a taxa uma única vez e usa os rótulos corretos ao aprovar e cancelar', async ({ page }, info) => {
  const { name, id } = await fixture(page, info, 'rotulos');
  await page.getByRole('combobox', { name: 'Filtrar por atendente', exact: true }).selectOption(id);
  const card = page.locator('.review-sale').filter({ has: page.getByText(name, { exact: true }) });
  await expect(card.locator('.review-values dt')).toHaveText(['Valor da venda', 'Taxa da venda', 'Valor do parceiro a liberar', 'Custo do gateway BRAVUS', 'Lucro BRAVUS projetado']);
  await expect(card.locator('.review-values dd').nth(0)).toHaveText(/219,00/);await expect(card.locator('.review-values dd').nth(1)).toHaveText(/28,28/);await expect(card.locator('.review-values dd').nth(2)).toHaveText(/190,72/);
  for (const wrong of ['Taxa do atendente', 'Taxa da BRAVUS', 'BRAVUS após taxas', 'Comissão']) await expect(card).not.toContainText(wrong);
  await card.getByRole('button', { name: 'Aprovar venda', exact: true }).click();
  const approve = page.getByRole('dialog', { name: 'Aprovar venda', exact: true });await expect(approve).toContainText('saldo do parceiro');await expect(approve).not.toContainText('saldo do atendente');await approve.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
  await expect(card).toHaveCount(0);await page.getByRole('combobox', { name: 'Situação da venda', exact: true }).selectOption('approved');
  await expect(card.locator('.review-values dt').nth(2)).toHaveText('Valor do parceiro liberado');
  await card.getByRole('button', { name: 'Cancelar venda aprovada', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancelar venda aprovada', exact: true });await expect(cancel).toContainText('valor do parceiro');await cancel.getByLabel('Motivo do cancelamento', { exact: true }).fill('Cancelamento sintético');await cancel.getByRole('button', { name: 'Confirmar cancelamento da venda', exact: true }).click();
  await page.getByRole('combobox', { name: 'Situação da venda', exact: true }).selectOption('all');await expect(card.locator('.review-values dt').nth(2)).toHaveText('Valor do parceiro cancelado');await expect(card.locator('.sale-status')).toHaveText('Cancelada');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('admin vê lucro após ADS próprios, exporta o valor e mantém lucro após registrar repasse', async ({ page }, info) => {
  const { name, id, saleId, today, personal } = await fixture(page, info, 'lucro');
  expect((await page.request.patch(`/api/admin/sales/${saleId}`, { headers: admin, data: { status: 'approved', note: '' } })).status()).toBe(200);
  expect((await page.request.post('/api/partner/ads', { headers: personal, data: { date: today, ads: '50' } })).status()).toBe(200);
  expect((await page.request.post(`/api/admin/attendants/${id}/costs`, { headers: admin, data: { date: today, ads: '10', withdrawalFee: '0' } })).status()).toBe(200);
  const refresh = () => page.getByRole('button', { name: 'Atualizar', exact: true }).click();await refresh();
  await expect(page.locator('.admin-stats [aria-label="Lucro dos parceiros após ADS"]')).toBeVisible();
  await page.getByRole('button', { name: 'Atendentes', exact: true }).click();
  const accountRow = page.locator('.admin-attendants tbody tr').filter({ has: page.getByText(name, { exact: true }) });await expect(accountRow.locator('[data-label="Lucro do parceiro após ADS"]')).toContainText('130,72');
  await accountRow.getByRole('button', { name: 'Ver faturamento e repasses', exact: true }).click();
  const balance = page.locator('.attendant-balance').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const value = (label: string) => balance.locator('dl>div').filter({ has: page.getByText(label, { exact: true }) });
  await expect(value('Taxas das vendas (conforme a data)')).toContainText('28,28');await expect(value('Custo do gateway BRAVUS')).toContainText('15,11');await expect(value('Lucro BRAVUS nas taxas')).toContainText('13,17');await expect(balance.getByRole('note')).toContainText('ADS não são descontados dos repasses.');await expect(value('ADS próprios do parceiro')).toContainText('50,00');await expect(value('Lucro do parceiro após ADS')).toContainText('130,72');await expect(value('Saldo disponível para repasse')).toContainText('190,72');
  await expect(balance).not.toContainText('Comissão após taxas');
  await page.getByRole('button', { name: 'Fechamento', exact: true }).click();
  await page.getByLabel('Início do período', { exact: true }).fill(today);await page.getByLabel('Fim do período', { exact: true }).fill(today);await page.getByRole('combobox', { name: 'Atendente do relatório', exact: true }).selectOption(id);await page.getByRole('button', { name: 'Consultar fechamento', exact: true }).click();
  const row = page.locator('.financial-table tbody tr');await expect(row).toHaveCount(1);const profitColumn = (await page.locator('.financial-table thead th').allTextContents()).indexOf('Lucro do parceiro após ADS');expect(profitColumn).toBeGreaterThanOrEqual(0);await expect(row.locator('td').nth(profitColumn)).toHaveText(/130,72/);await expect(page.locator('.partner-report-metrics')).toContainText('130,72');
  const download = page.waitForEvent('download');await page.getByRole('button', { name: 'Exportar CSV', exact: true }).click();const csv = await readFile((await (await download).path())!, 'utf8');expect(csv).toContain('Lucro do parceiro após ADS');expect(csv).toContain('130,72;217,87;15,11');
  expect((await page.request.patch('/api/profile', { headers: personal, data: { name, email: '', phone: '', pixType: 'email', pixKey: 'partner-fixture@example.test', pixOwner: name } })).status()).toBe(200);
  expect((await page.request.post('/api/admin/payouts', { headers: { ...admin, 'Idempotency-Key': `fixture_partner_admin_paid_${info.project.name}` }, data: { attendantId: id, amount: '100', note: 'PIX sintético' } })).status()).toBe(201);
  await refresh();await expect(page.locator('.financial-table tbody tr td').nth(profitColumn)).toHaveText(/130,72/);
  await page.getByRole('button', { name: 'Repasses', exact: true }).click();await expect(value('Lucro do parceiro após ADS')).toContainText('130,72');await expect(value('Saldo disponível para repasse')).toContainText('90,72');
  await page.getByRole('button', { name: 'Custos ADS', exact: true }).click();
  await page.getByRole('combobox', { name: 'Atendente', exact: true }).selectOption(id);
  await expect(page.getByRole('note')).toContainText('ADS não são descontados dos repasses.');
  const adminAds = page.getByLabel('Custo ADS (R$)', { exact: true });await expect(adminAds).toBeEnabled();await expect(adminAds).toHaveValue('10.00');await adminAds.fill('500');
  await page.getByRole('button', { name: 'Salvar custos do dia', exact: true }).click();await expect(page.getByRole('status')).toContainText('Custos diários salvos');
  await page.getByRole('button', { name: 'Repasses', exact: true }).click();await expect(value('Saldo disponível para repasse')).toContainText('90,72');await expect(value('Lucro do parceiro após ADS').locator('dd')).toHaveText(/^-R\$\s*359,28$/);await expect(value('Lucro BRAVUS nas taxas')).toContainText('13,17');
  const ownPortal = await (await page.request.get('/api/portal?period=all', { headers: personal })).json();expect(ownPortal.finance.availableCents).toBe(9072);expect(ownPortal.marketing.profitCents).toBe(-35928);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);await page.screenshot({ path: info.outputPath('lucro-parceiro-admin.png'), fullPage: true });
});
