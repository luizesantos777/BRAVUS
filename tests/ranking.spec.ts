import { expect, test } from '@playwright/test';

const entries = [
  { id: 'fixture-champion', name: 'Jottaa', photoUrl: '', grossCents: 223527, count: 16, mine: false },
  { id: 'fixture-second', name: 'Luiz lucro certo', photoUrl: '', grossCents: 92591, count: 11, mine: true },
  { id: 'fixture-third', name: 'Japa', photoUrl: '', grossCents: 25500, count: 2, mine: false },
  { id: 'fixture-fourth', name: 'Raposo', photoUrl: '', grossCents: 12500, count: 1, mine: false },
];

test('parceiro e atendente encontram Ranking e o atalho, carregam vendas reais e reabrem o link direto', async ({ page }, info) => {
  const admin = { Authorization: 'Bearer fixture_browser_admin_012345678901234567890123456789' };
  const accounts: { id: string; token: string; name: string; kind: string }[] = [];
  for (const kind of ['partner', 'attendant']) {
    const name = `Ranking ${kind} ${info.project.name}`, token = `fixture_rank_access_${kind}_${info.project.name}_01234567890123456789`;
    const created = await page.request.post('/api/admin/attendants', { headers: admin, data: { name, token, accountKind: kind } });expect(created.status()).toBe(201);
    const account = await created.json(), personal = { Authorization: `Bearer ${token}` };
    const portal = await (await page.request.get('/api/portal', { headers: personal })).json();
    expect((await page.request.post('/api/sales', { headers: { ...personal, 'Idempotency-Key': `fixture_rank_access_sale_${kind}_${info.project.name}` }, data: { date: portal.today, sales: [{ amount: '100', checkoutId: 'main', time: '12:00', note: '', receipt: { name: 'ranking.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=' } }] } })).status()).toBe(200);
    const sale = (await (await page.request.get('/api/portal', { headers: personal })).json()).sales[0];
    expect((await page.request.patch(`/api/admin/sales/${sale.id}`, { headers: admin, data: { status: 'approved', note: '' } })).status()).toBe(200);
    accounts.push({ id: account.attendantId, token, name, kind });
  }
  for (const account of accounts) {
    await page.goto(`/#/atendente/${account.token}`);
    const tab = page.getByRole('tab', { name: 'Ranking', exact: true });await expect(tab).toBeVisible();
    const shortcut = page.getByRole('button', { name: 'Ver pódio e ranking', exact: true });await expect(shortcut).toBeEnabled();await shortcut.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');await expect(page.getByRole('heading', { name: /Pódio e Ranking/ })).toBeVisible();
    await expect(page.locator('.ranking-entry.mine')).toContainText(account.name);await expect(page.locator('.ranking-entry.mine')).toContainText('100,00');
    const response = await page.request.get('/api/ranking?period=last30', { headers: { Authorization: `Bearer ${account.token}` } });expect(response.status()).toBe(200);
    const ranking = await response.json();for (const member of accounts) expect(ranking.some((entry: { id: string }) => entry.id === member.id)).toBe(true);
    const entry = account.kind === 'partner' ? '/parceiro.html' : '/';
    await page.goto(`${entry}?aba=ranking#/atendente/${account.token}`);await expect(page.getByRole('heading', { name: /Pódio e Ranking/ })).toBeVisible();
    await page.reload();await expect(page.locator('.ranking-entry.mine')).toContainText(account.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('pódio mantém 2-1-3, marca Você e permite diário, 7 dias, 30 dias e intervalo no calendário', async ({ page }, info) => {
  const requests: URL[] = [];
  await page.route('**/api/ranking?*', route => {
    const url = new URL(route.request().url());requests.push(url);
    return route.fulfill({ json: url.searchParams.get('period') === 'custom' ? entries.slice(3) : entries });
  });
  const token = `fixture_${info.project.name}_primary_01234567890123456789`;
  await page.goto(`/#/atendente/${token}`);await page.getByRole('tab', { name: 'Ranking', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pódio e Ranking de Desempenho (30 Dias)', exact: true })).toBeVisible();
  const champion = page.getByRole('article', { name: '1º lugar: Jottaa', exact: true }), second = page.getByRole('article', { name: '2º lugar: Luiz lucro certo', exact: true }), third = page.getByRole('article', { name: '3º lugar: Japa', exact: true });
  await expect(champion).toContainText('#1 CAMPEÃO');await expect(champion).toContainText('2.235,27');await expect(champion).toContainText('16 vendas');await expect(second).toContainText('Você');await expect(third).toContainText('255,00');
  const gold = (await champion.boundingBox())!, silver = (await second.boundingBox())!, bronze = (await third.boundingBox())!;
  expect(silver.x).toBeLessThan(gold.x);expect(gold.x).toBeLessThan(bronze.x);
  const heights = await Promise.all([champion, second, third].map(async card => (await card.locator('.podium-step').boundingBox())!.height));expect(heights[0]).toBeGreaterThan(heights[1]);expect(heights[1]).toBeGreaterThan(heights[2]);
  await expect(page.locator('.ranking-rest li')).toHaveCount(1);await expect(page.locator('.ranking-rest li')).toContainText('Raposo');
  expect(requests.at(-1)!.searchParams.get('period')).toBe('last30');
  await page.locator('.podium-panel').screenshot({ path: info.outputPath('podio-ranking.png') });
  await page.getByRole('button', { name: 'Diário', exact: true }).click();await expect(page.getByRole('heading', { name: /Desempenho \(Diário\)/ })).toBeVisible();await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('today');
  await page.getByRole('button', { name: '7 dias', exact: true }).click();await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('week');
  await page.getByRole('button', { name: '30 dias', exact: true }).click();await expect.poll(() => requests.at(-1)?.searchParams.get('period')).toBe('last30');
  await page.getByLabel('Período do extrato', { exact: true }).selectOption('yesterday');await expect(page.getByRole('heading', { name: /Desempenho \(30 Dias\)/ })).toBeVisible();
  const today = (await (await page.request.get('/api/portal', { headers: { Authorization: `Bearer ${token}` } })).json()).today;
  await page.getByRole('button', { name: 'Personalizar', exact: true }).click();
  await page.getByLabel('Data inicial do ranking', { exact: true }).fill(today);await page.getByLabel('Data final do ranking', { exact: true }).fill(today);
  await page.getByRole('button', { name: 'Aplicar período', exact: true }).click();await expect(page.getByRole('heading', { name: /Desempenho \(Personalizado\)/ })).toBeVisible();
  await expect(page.getByRole('article', { name: '1º lugar: Raposo', exact: true })).toBeVisible();await expect(page.locator('.podium-entry')).toHaveCount(1);
  expect(requests.at(-1)!.searchParams.get('start')).toBe(today);expect(requests.at(-1)!.searchParams.get('end')).toBe(today);
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.podium-panel').screenshot({ path: info.outputPath('ranking-calendario.png') });
});

test('falha do ranking exibe nova tentativa e período sem vendas não inventa participantes', async ({ page }, info) => {
  let attempts = 0;
  await page.route('**/api/ranking?*', route => ++attempts === 1 ? route.fulfill({ status: 503, json: { error: 'Ranking temporariamente indisponível.' } }) : route.fulfill({ json: [] }));
  await page.goto(`/#/atendente/fixture_${info.project.name}_primary_01234567890123456789`);await page.getByRole('tab', { name: 'Ranking', exact: true }).click();
  await expect(page.locator('.ranking-error')).toContainText('Ranking temporariamente indisponível.');await expect(page.locator('.podium-panel .empty')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();await expect(page.locator('.podium-panel .empty')).toContainText('vendas aprovadas neste período');
  await expect(page.locator('.podium-entry')).toHaveCount(0);
});
