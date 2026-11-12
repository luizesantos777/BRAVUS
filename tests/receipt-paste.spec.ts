import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const admin = { Authorization: 'Bearer fixture_browser_admin_012345678901234567890123456789' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=';

async function copyImage(page: Page, color: string) {
  await page.bringToFront();
  await page.evaluate(async color => {
    const canvas = document.createElement('canvas');canvas.width = 320;canvas.height = 120;
    const context = canvas.getContext('2d')!;context.fillStyle = color;context.fillRect(0, 0, 320, 120);
    context.fillStyle = '#fff';context.font = '18px sans-serif';context.fillText('COMPROVANTE DE TESTE', 18, 48);context.fillText('SEM TRANSAÇÃO REAL', 18, 80);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, color);
}
async function dispatchFiles(target: Locator, files: { name: string; mime: string; base64: string }[]) {
  await target.evaluate((element, files) => {
    const clipboard = new DataTransfer();
    for (const file of files) clipboard.items.add(new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], file.name, { type: file.mime }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, files);
}

for (const kind of ['attendant', 'partner']) test(`${kind}: Ctrl+V anexa na venda correta, preserva texto, rascunho e comprovante recebido pelo admin`, async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const name = `Colagem ${kind} ${info.project.name}`, token = `fixture_paste_${kind}_${info.project.name}_01234567890123456789`, personal = { Authorization: `Bearer ${token}` };
  const created = await page.request.post('/api/admin/attendants', { headers: admin, data: { name, token, accountKind: kind } });expect(created.status()).toBe(201);
  const { attendantId } = await created.json();
  const requests: { body: string | null; key: string | undefined }[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/sales' && request.method() === 'POST') requests.push({ body: request.postData(), key: request.headers()['idempotency-key'] }); });
  await page.goto(`/#/atendente/${token}`);
  await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toBeEnabled();
  await copyImage(page, '#145525');await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());await page.keyboard.press('Control+V');
  await expect(page.locator('.attachment-detail')).toBeVisible();await page.getByRole('button', { name: 'Remover print venda 1', exact: true }).click();
  for (const number of [1, 2]) {
    if (number === 2) await page.getByRole('button', { name: 'Adicionar Outra Venda', exact: true }).click();
    await page.getByLabel(`Valor bruto venda ${number}`, { exact: true }).fill(String(number * 100));
    if (kind === 'attendant') await page.getByLabel(`Checkout venda ${number}`, { exact: true }).selectOption('main');
  }
  await page.evaluate(() => navigator.clipboard.writeText('Texto colado normalmente'));
  const observation = page.getByLabel('Observação venda 2', { exact: true });await observation.focus();await page.keyboard.press('Control+V');await expect(observation).toHaveValue('Texto colado normalmente');
  await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await copyImage(page, '#164b2a');await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());await page.keyboard.press('Control+V');
  await expect(page.locator('.sales-panel .form-error')).toContainText('Há várias vendas');await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Área para colar comprovante venda 2', exact: true }).click();await page.keyboard.press('Control+V');
  await expect(page.locator('.sale-row').nth(1).locator('.attachment-detail')).toBeVisible();await expect(page.locator('.sale-row').nth(0).locator('.attachment-detail')).toHaveCount(0);
  await expect(observation).toHaveValue('Texto colado normalmente');
  await page.locator('.sale-row').nth(1).locator('.attachment-detail button').first().click();
  await expect(page.getByRole('img', { name: 'Print do comprovante da venda', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  await copyImage(page, '#28416b');await page.getByRole('button', { name: 'Colar comprovante venda 1', exact: true }).click();
  await expect(page.locator('.attachment-detail')).toHaveCount(2);await expect(page.getByLabel('Valor bruto venda 1', { exact: true })).toHaveValue('100');
  await expect(page.locator('.draft-status')).toContainText('Rascunho salvo');expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);await page.screenshot({ path: info.outputPath(`colar-comprovante-${kind}.png`), fullPage: true });
  await page.reload();await expect(page.locator('.attachment-detail')).toHaveCount(2);await expect(observation).toHaveValue('Texto colado normalmente');
  if (kind === 'partner') {
    let loseOnce = true;
    await page.route('**/api/sales', async route => { const response = await route.fetch();if (loseOnce) { loseOnce = false;await route.abort('failed'); } else await route.fulfill({ response }); });
  }
  await page.getByRole('button', { name: 'Salvar e Enviar Vendas', exact: true }).click();
  if (kind === 'partner') {
    const confirm = page.getByRole('button', { name: 'Confirmar envio', exact: true });await expect(confirm).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Colar comprovante venda 1', exact: true })).toBeDisabled();
    await dispatchFiles(page.locator('.sale-row').first(), [{ name: 'nao-alterar-envio.png', mime: 'image/png', base64: png }]);
    await expect(page.locator('.sale-rows')).not.toContainText('nao-alterar-envio.png');await confirm.click();
    await expect(page.getByRole('status')).toContainText('Enviada à administração');expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  } else await expect(page.getByRole('status')).toContainText('Enviada à administração');
  const payload = JSON.parse(requests[0].body!), portal = await (await page.request.get('/api/portal?period=all', { headers: personal })).json();expect(portal.sales).toHaveLength(2);
  for (const sale of portal.sales) {
    const sent = payload.sales.find((row: { amount: string }) => Number(row.amount) * 100 === sale.amountCents);
    const received = await page.request.get(`/api/admin/receipts/${sale.receiptId}`, { headers: admin });expect(received.status()).toBe(200);expect(received.headers()['content-type']).toBe('image/png');expect(await received.body()).toEqual(Buffer.from(sent.receipt.base64, 'base64'));
  }
  await page.goto('/#/admin');await page.getByLabel('Chave administrativa').fill(admin.Authorization.slice(7));await page.getByRole('button', { name: 'Entrar na administração', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filtrar por atendente', exact: true }).selectOption(attendantId);await expect(page.locator('.review-sale')).toHaveCount(2);
  await page.locator('.review-sale').first().getByRole('button', { name: 'Ver comprovante', exact: true }).click();await expect(page.getByRole('img', { name: 'Comprovante da venda', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('colagem inválida ou com várias imagens limpa o anexo anterior; leitura lenta não sobrescreve a escolha mais recente', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');const target = page.getByRole('textbox', { name: 'Área para colar comprovante venda 1', exact: true });
  await copyImage(page, '#164b2a');await target.click();await page.keyboard.press('Control+V');await expect(page.locator('.attachment-detail')).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText('https://example.invalid/comprovante.png'));await target.focus();await page.keyboard.press('Control+V');
  await expect(page.locator('.attachment-error')).toContainText('não apenas o link ou o texto');await expect(target).toBeEmpty();
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'read', { configurable: true, value: async () => { throw new DOMException('fixture denied', 'NotAllowedError'); } }); });
  await page.getByRole('button', { name: 'Colar comprovante venda 1', exact: true }).click();await expect(page.locator('.attachment-error')).toContainText('navegador não permitiu');
  await copyImage(page, '#164b2a');await target.focus();await page.keyboard.press('Control+V');await expect(page.locator('.attachment-detail')).toBeVisible();
  await dispatchFiles(target, [{ name: 'falso.jpg', mime: 'image/jpeg', base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') }]);
  await expect(page.locator('.attachment-error')).toContainText('Escolha um print PNG, JPG ou WEBP');await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await dispatchFiles(target, [{ name: 'um.png', mime: 'image/png', base64: png }, { name: 'dois.png', mime: 'image/png', base64: png }]);
  await expect(page.locator('.attachment-error')).toContainText('apenas uma imagem');await expect(page.locator('.attachment-detail')).toHaveCount(0);
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;let count = 0;
    FileReader.prototype.readAsDataURL = function (blob: Blob) { setTimeout(() => original.call(this, blob), ++count === 1 ? 600 : 30); };
  });
  await dispatchFiles(target, [{ name: 'antigo.png', mime: 'image/png', base64: png }]);await expect(page.getByRole('button', { name: 'Preparando imagens...', exact: true })).toBeDisabled();
  await page.getByLabel('Print da venda 1', { exact: true }).setInputFiles({ name: 'novo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.attachment-detail')).toContainText('novo.png');await page.waitForTimeout(650);
  await expect(page.locator('.attachment-detail')).not.toContainText('antigo.png');await expect(page.locator('.attachment-error')).toHaveCount(0);
});
