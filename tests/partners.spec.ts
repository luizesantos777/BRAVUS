import { expect, test } from '@playwright/test';

const adminKey = 'fixture_browser_admin_012345678901234567890123456789';
const receipt = {
  name: 'comprovante-parceiro.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=', 'base64'),
};

test('administrador cadastra parceiro com link individual e venda de R$ 100 libera R$ 90 após aprovação', async ({ page, context }, info) => {
  const name = `Parceiro financeiro ${info.project.name}`;
  const token = `fixture_partner_${info.project.name}_01234567890123456789`;
  const personal = { Authorization: `Bearer ${token}` };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/#/admin');
  await page.getByLabel('Chave administrativa').fill(adminKey);
  await page.getByRole('button', { name: 'Entrar na administração' }).click();
  await page.getByRole('button', { name: 'Atendentes', exact: true }).click();
  await page.getByRole('button', { name: 'Novo parceiro', exact: true }).click();

  const form = page.getByRole('dialog', { name: 'Novo parceiro', exact: true });
  await expect(form.getByRole('combobox', { name: 'Tipo de conta', exact: true })).toHaveValue('partner');
  await expect(form.getByLabel('Comissão (%)', { exact: true })).toHaveCount(0);
  await expect(form).toContainText('10%');
  await form.getByLabel('Nome do parceiro', { exact: true }).fill(name);
  await form.getByLabel('Token do parceiro (opcional)', { exact: true }).fill(token);
  await form.getByRole('button', { name: 'Criar parceiro e token', exact: true }).click();

  const invitation = page.getByLabel('Link privado do parceiro', { exact: true });
  await expect(invitation).toBeVisible();
  const privateLink = await invitation.inputValue();
  expect(new URL(privateLink).hash.split('/').at(-1)).toBe(token);
  expect(privateLink).not.toContain(adminKey);
  const accountResponse = await page.request.get('/api/portal', { headers: personal });
  expect(accountResponse.status()).toBe(200);
  const account = await accountResponse.json();
  expect(account.profile.accountKind).toBe('partner');
  expect(account.profile.commissionBps).toBe(10000);
  expect((await page.request.get('/api/admin/dashboard', { headers: personal })).status()).toBe(401);
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();

  const row = page.locator('.admin-attendants tbody tr').filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toContainText('Parceiro');

  // A new page receives only the individual link, without the administrative key.
  const partnerPage = await context.newPage();
  partnerPage.on('pageerror', error => errors.push(error.message));
  await partnerPage.goto(privateLink);
  await expect(partnerPage.getByRole('heading', { name: 'Portal do Parceiro.', exact: true })).toBeVisible();
  await expect(partnerPage.getByLabel('Chave administrativa')).toHaveCount(0);
  await expect(partnerPage.getByText('Você está na demonstração.')).toHaveCount(0);
  await partnerPage.getByLabel('Valor bruto venda 1', { exact: true }).fill('100');
  await partnerPage.getByLabel('Checkout venda 1', { exact: true }).selectOption('main');
  const preview = partnerPage.getByLabel('Taxas da venda 1', { exact: true });
  await expect(preview).toContainText('Taxa do gateway (10%)');
  await expect(preview).toContainText('10,00');
  await expect(preview).toContainText('90,00');
  await expect(preview).not.toContainText('50%');
  await partnerPage.getByLabel('Print da venda 1', { exact: true }).setInputFiles(receipt);
  await partnerPage.getByRole('button', { name: 'Salvar e Enviar Vendas', exact: true }).click();
  await expect(partnerPage.locator('.pending-sales-notice')).toContainText('1 venda(s) em análise');
  await expect(partnerPage.locator('.metric.balance')).toContainText('0,00');

  await page.getByRole('button', { name: 'Aprovar vendas', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filtrar por atendente', exact: true }).selectOption(account.profile.id);
  await expect(page.locator('.review-sale')).toHaveCount(1);
  await page.getByRole('button', { name: 'Aprovar venda', exact: true }).click();
  await page.getByLabel('Observação da aprovação (opcional)', { exact: true }).fill('Comprovante sintético conferido');
  await page.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
  await expect(page.locator('.review-sale')).toHaveCount(0);

  await partnerPage.getByRole('button', { name: 'Atualizar vendas', exact: true }).click();
  await expect(partnerPage.locator('.metric.balance')).toContainText('90,00');
  await expect(partnerPage.locator('.history-panel .sale-status')).toHaveText('Aprovada');
  const approved = await (await partnerPage.request.get('/api/portal', { headers: personal })).json();
  expect(approved.finance.availableCents).toBe(9000);
  expect(approved.finance.transactionFeeCents).toBe(1000);
  expect(approved.sales).toHaveLength(1);
  expect(approved.sales[0]).toMatchObject({ amountCents: 10000, feeCents: 1000, attendantFeeCents: 1000 });

  await partnerPage.reload();
  await expect(partnerPage.getByRole('heading', { name: 'Portal do Parceiro.', exact: true })).toBeVisible();
  await expect(partnerPage.locator('.metric.balance')).toContainText('90,00');
  expect(await partnerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await partnerPage.evaluate(() => Object.keys(localStorage).filter(key => /admin|token/i.test(key)))).toEqual([]);
  expect(errors).toEqual([]);
  await partnerPage.screenshot({ path: info.outputPath('parceiro-venda-100-saldo-90.png'), fullPage: true });
  await partnerPage.close();
});
