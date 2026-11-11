import { expect, test } from '@playwright/test';

const adminKey = 'fixture_browser_admin_012345678901234567890123456789';
const receipt = {
  name: 'comprovante-parceiro.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=', 'base64'),
};

test('administrador cadastra parceiro com link individual e venda de R$ 100 libera R$ 88 após aprovação', async ({ page, context }, info) => {
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
  await expect(form).toContainText('12%');
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
  await expect(partnerPage.getByLabel('Checkout venda 1', { exact: true })).toHaveCount(0);
  const preview = partnerPage.getByLabel('Taxas da venda 1', { exact: true });
  await expect(preview).toContainText('Taxa do gateway (12%)');
  await expect(preview).toContainText('12,00');
  await expect(preview).toContainText('88,00');
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
  await expect(partnerPage.locator('.metric.balance')).toContainText('88,00');
  await expect(partnerPage.locator('.history-panel .sale-status')).toHaveText('Aprovada');
  const approved = await (await partnerPage.request.get('/api/portal', { headers: personal })).json();
  expect(approved.finance.availableCents).toBe(8800);
  expect(approved.finance.transactionFeeCents).toBe(1200);
  expect(approved.sales).toHaveLength(1);
  expect(approved.sales[0]).toMatchObject({ amountCents: 10000, feeCents: 1200, attendantFeeCents: 1200 });

  await partnerPage.reload();
  await expect(partnerPage.getByRole('heading', { name: 'Portal do Parceiro.', exact: true })).toBeVisible();
  await expect(partnerPage.locator('.metric.balance')).toContainText('88,00');
  expect(await partnerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await partnerPage.evaluate(() => Object.keys(localStorage).filter(key => /admin|token/i.test(key)))).toEqual([]);
  // The manual payment dialog must use the same zero-fee rule as the ledger,
  // including a small amount below the old R$ 2.50 minimum.
  const pixResponse = await partnerPage.request.patch('/api/profile', { headers: personal, data: { name, email: '', phone: '', pixType: 'email', pixKey: 'partner-fixture@example.test', pixOwner: name } });
  expect(pixResponse.status()).toBe(200);
  const updatedDashboard = page.waitForResponse(response => response.url().includes('/api/admin/dashboard') && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();await updatedDashboard;
  await page.getByRole('button', { name: 'Repasses', exact: true }).click();
  await page.getByRole('combobox', { name: 'Atendente do repasse', exact: true }).selectOption(account.profile.id);
  const amount = page.getByLabel('Valor total a debitar do saldo (R$)', { exact: true });
  await amount.fill('1');await page.getByLabel('Observação do repasse manual', { exact: true }).fill('PIX de teste sem tarifa');
  await page.getByRole('button', { name: 'Registrar pagamento realizado', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Confirmar repasse manual', exact: true });
  await expect(confirmation).toContainText('1,00');await expect(confirmation).toContainText('0,00 de taxa');
  await confirmation.getByRole('button', { name: 'Voltar', exact: true }).click();
  await amount.fill('88');await page.getByRole('button', { name: 'Registrar pagamento realizado', exact: true }).click();
  await expect(confirmation).toContainText('88,00');await expect(confirmation).not.toContainText('85,50');
  await confirmation.getByRole('button', { name: 'Confirmar PIX já realizado', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Repasse manual registrado');
  const settled = await (await partnerPage.request.get('/api/portal?period=all', { headers: personal })).json();
  expect(settled.finance.availableCents).toBe(0);expect(settled.finance.paidPayoutNetCents).toBe(8800);
  expect(settled.payouts[0].withdrawalFeeCents).toBe(0);expect(settled.payouts[0].gatewayFeeCents).toBe(0);
  await partnerPage.getByRole('tab', { name: /Repasses/ }).click();
  await expect(partnerPage.locator('.payouts-panel .payout-help')).toContainText('sem taxa de saque');
  expect(errors).toEqual([]);
  await partnerPage.screenshot({ path: info.outputPath('parceiro-venda-100-saldo-88.png'), fullPage: true });
  await partnerPage.close();
});
