import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function partnerMetadata(page: Page) {
  await expect(page).toHaveTitle('Lucro Certo — Portal do Parceiro BRAVUS');
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) await expect(page.locator(selector)).toHaveAttribute('content', 'Lucro Certo — Portal do Parceiro BRAVUS');
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) await expect(page.locator(selector)).toHaveAttribute('content', 'Portal do Parceiro BRAVUS. Acompanhe suas vendas e pagamentos.');
}
test('HTML público do parceiro, link antigo, recarga e navegação pela administração mantêm a identificação correta', async ({ page }, info) => {
  const token = `fixture_${info.project.name}_exclusive_01234567890123456789`;
  for (const path of ['/parceiro.html', '/parceiro', '/parceiro/']) {
    const response = await page.request.get(path); expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<title>Lucro Certo — Portal do Parceiro BRAVUS</title>');
    expect(html).toContain('property="og:title" content="Lucro Certo — Portal do Parceiro BRAVUS"');
    expect(html).toContain('name="twitter:title" content="Lucro Certo — Portal do Parceiro BRAVUS"');
    expect(html).not.toContain(token);
  }
  await page.goto('/parceiro.html'); await partnerMetadata(page);
  await expect(page.getByRole('heading', { name: 'Acesso individual do parceiro', exact: true })).toBeVisible();
  await page.goto(`/#/atendente/${token}`); await partnerMetadata(page);
  await expect(page).toHaveURL(new RegExp(`/parceiro\\.html#/atendente/${token}$`));
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', 'Lucro Certo');
  await page.reload(); await partnerMetadata(page);
  await page.goto('/#/admin'); await expect(page).toHaveTitle('Lucro Certo Gestão — Administração BRAVUS');
  await page.evaluate(token => { window.location.hash = '/atendente/' + token; }, token);
  await expect(page.getByRole('heading', { name: 'Portal do Parceiro.', exact: true })).toBeVisible(); await partnerMetadata(page);
  const ordinary = `fixture_${info.project.name}_primary_01234567890123456789`;
  await page.evaluate(token => { window.location.hash = '/atendente/' + token; }, ordinary);
  await expect(page).toHaveTitle('Lucro Certo — Portal do Atendente BRAVUS');
  await expect(page).toHaveURL(new RegExp(`/#/atendente/${ordinary}$`));
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Lucro Certo — Portal do Atendente BRAVUS');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Portal individual do atendente/);
});
test('HTML do parceiro já identifica o acesso enquanto a API carrega, sem expor o token no caminho ou na descrição', async ({ page }, info) => {
  const token = `fixture_${info.project.name}_exclusive_01234567890123456789`;
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/portal?period=today', async route => { await ready; await route.continue(); });
  try {
    await page.goto(`/parceiro.html#/atendente/${token}`, { waitUntil: 'domcontentloaded' });
    await partnerMetadata(page); await expect(page.getByRole('heading', { name: 'Portal do Parceiro.', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Portal do Atendente.', exact: true })).toHaveCount(0);
    expect(new URL(page.url()).pathname).not.toContain(token);
    release(); await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toBeEnabled(); await expect(page.getByLabel('Checkout venda 1', { exact: true })).toHaveCount(0); await partnerMetadata(page);
  } finally { release(); }
});
