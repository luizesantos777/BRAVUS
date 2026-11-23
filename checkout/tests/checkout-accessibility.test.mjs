import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import axe from 'axe-core';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkoutUrl = 'http://localhost/checkout';
const pixId = '11111111-1111-4111-8111-111111111111';
const pixPath = `/pagar/${pixId}`;
const pixCode = '000201-PIX-DE-TESTE';
const pixQr = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>');
const buyerSettings = {
  configured: true,
  provider: 'beehive',
  buyerRequirements: { fullIdentity: false, buyerDetailsRequired: true, phoneRequired: true, bravusCompanyAvailable: false },
};
const pixPayment = { amount: 9989, paid: false, canVerify: true, unavailable: false, code: pixCode, qrUrl: pixQr };

let browser, script, stylesheet;
before(async () => {
  const styles = new URL('../app/globals.css', import.meta.url);
  const [bundle, css] = await Promise.all([
    build({
      absWorkingDir: root,
      stdin: {
        loader: 'tsx',
        resolveDir: root,
        contents: `
          import {createRoot} from 'react-dom/client';
          import Checkout from './app/checkout/ui.tsx';
          import Payment from './app/pagar/[id]/ui.tsx';
          import {BIOCAMISAS_BRAND} from './lib/checkout-brand.ts';
          const path = location.pathname;
          const brand = new URLSearchParams(location.search).has('bio') ? BIOCAMISAS_BRAND : undefined;
          createRoot(document.getElementById('root')).render(path.startsWith('/pagar/')
            ? <Payment id={path.split('/').pop()} brand={brand} />
            : <Checkout canConfigure={false} brand={brand} partnerName={new URLSearchParams(location.search).get('seller') || undefined} />);
        `,
      },
      bundle: true,
      write: false,
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    }),
    readFile(styles, 'utf8').then(source => postcss([tailwind({ base: root })]).process(source, { from: fileURLToPath(styles) })),
  ]);
  script = bundle.outputFiles[0].text;
  stylesheet = css.css;
  browser = await chromium.launch({ executablePath: process.env.BRAVUS_CHROMIUM_PATH || undefined });
});
after(async () => { await browser?.close(); });

async function openFixture(t, { viewport, onOrder, onSettings, readPayment = () => pixPayment } = {}) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  await context.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (target.origin !== 'http://localhost') return route.abort('blockedbyclient');
    switch (target.pathname) {
      case '/checkout':
      case pixPath:
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body:
          '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Checkout de teste</title>' +
          '<link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
      case '/fixture.js':
        return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: script });
      case '/fixture.css':
        return route.fulfill({ contentType: 'text/css; charset=utf-8', body: stylesheet });
      case '/assets/bravus-logo.jpg':
      case '/assets/bio-camisas-logo.png':
        return route.fulfill({ path: fileURLToPath(new URL(`../public${target.pathname}`, import.meta.url)) });
      case '/api/settings':
        return route.fulfill({ json: onSettings ? await onSettings(target) : buyerSettings });
      case `/api/pay/${pixId}`:
        return route.fulfill({ json: readPayment() });
      case '/api/orders':
        if (onOrder) return onOrder(route);
        break;
    }
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  return page;
}

async function auditPaymentPage(page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run('main', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return result.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(node => node.target.join(' ')) }));
  });
  assert.deepEqual(violations, []);
}

test('checkout buyer fields are labeled and accessible on a small viewport', { timeout: 18000 }, async t => {
  const page = await openFixture(t, { viewport: { width: 390, height: 844 } });
  await page.goto(checkoutUrl);
  const heading = page.getByRole('heading', { level: 1, name: 'Finalize seu pedido via PIX' });
  const method = page.getByRole('combobox', { name: 'Forma de pagamento' });
  await heading.waitFor();
  await method.waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await method.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  const amount = page.getByRole('textbox', { name: /Valor total da compra/ });
  assert.equal(await amount.evaluate(element => element === document.activeElement), true);

  for (const name of ['Nome completo', 'E-mail', 'CPF ou CNPJ', 'Telefone com DDD']) {
    assert.equal(await page.getByRole('textbox', { name, exact: true }).isVisible(), true);
  }
  await auditPaymentPage(page);
});

test('checkout waits for the amount-specific gateway before generating the PIX', { timeout: 18000 }, async t => {
  const requests = [];
  const settings = {
    ...buyerSettings,
    buyerRequirements: { fullIdentity: false, buyerDetailsRequired: false, phoneRequired: false, bravusCompanyAvailable: false },
  };
  const page = await openFixture(t, {
    onSettings: async target => {
      if (target.searchParams.has('amount')) {
        await new Promise(resolve => setTimeout(resolve, 500));
        return { ...settings, provider: 'buckpay' };
      }
      return settings;
    },
    onOrder: route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { url: new URL(pixPath, checkoutUrl).href } });
    },
  });
  await page.goto(checkoutUrl + '?seller=Deda');
  await page.getByRole('combobox', { name: 'Forma de pagamento' }).selectOption('credit_card');
  const amount = page.getByRole('textbox', { name: /Valor total da compra/ });
  const generate = page.getByRole('button', { name: /Gerar PIX em nova guia|Conferindo forma de pagamento/ });
  await amount.fill('99,89');
  await page.waitForTimeout(50);
  assert.equal(await generate.isDisabled(), true);
  await generate.click();
  await page.getByRole('link', { name: 'Abrir página de pagamento' }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].provider, 'buckpay');
  assert.equal(requests[0].paymentMethod, 'pix');
});

test('checkout generates the first PIX when the amount selects Poseidon', { timeout: 18000 }, async t => {
  const requests = [];
  const poseidon = {
    configured: true,
    provider: 'poseidon',
    buyerRequirements: { fullIdentity: false, buyerDetailsRequired: true, phoneRequired: true, bravusCompanyAvailable: false },
  };
  const page = await openFixture(t, {
    onSettings: async target => {
      if (target.searchParams.has('amount')) {
        await new Promise(resolve => setTimeout(resolve, 250));
        return poseidon;
      }
      return buyerSettings;
    },
    onOrder: route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { url: new URL(pixPath, checkoutUrl).href } });
    },
  });
  await page.goto(checkoutUrl + '?seller=Deda');
  await page.getByRole('textbox', { name: /Valor total da compra/ }).fill('99,89');
  await page.getByRole('textbox', { name: 'Nome completo', exact: true }).fill('Maria Souza');
  await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill('maria@example.test');
  await page.getByRole('textbox', { name: 'CPF ou CNPJ', exact: true }).fill('52998224725');
  await page.getByRole('textbox', { name: 'Telefone com DDD', exact: true }).fill('11999999999');
  await page.getByRole('button', { name: /Gerar PIX em nova guia|Conferindo forma de pagamento/ }).click();
  await page.getByRole('link', { name: 'Abrir página de pagamento' }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].provider, 'poseidon');
  assert.equal(requests[0].paymentMethod, 'pix');
  assert.equal(requests[0].customer.name, 'Maria Souza');
});

test('checkout resynchronizes a transient Poseidon requirement change in the same click', { timeout: 18000 }, async t => {
  const requests = [];
  let amountCalls = 0;
  const poseidon = phoneRequired => ({
    configured: true,
    provider: 'poseidon',
    buyerRequirements: { fullIdentity: false, buyerDetailsRequired: true, phoneRequired, bravusCompanyAvailable: false },
  });
  const page = await openFixture(t, {
    onSettings: async target => {
      if (target.searchParams.has('amount')) {
        amountCalls += 1;
        return poseidon(amountCalls === 1);
      }
      return poseidon(true);
    },
    onOrder: route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { url: new URL(pixPath, checkoutUrl).href } });
    },
  });
  await page.goto(checkoutUrl + '?seller=Deda');
  await page.getByRole('textbox', { name: /Valor total da compra/ }).fill('99,89');
  await page.getByRole('textbox', { name: 'Nome completo', exact: true }).fill('Maria Souza');
  await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill('maria@example.test');
  await page.getByRole('textbox', { name: 'CPF ou CNPJ', exact: true }).fill('52998224725');
  await page.getByRole('textbox', { name: 'Telefone com DDD', exact: true }).fill('11999999999');
  await page.getByRole('button', { name: /Gerar PIX em nova guia|Conferindo forma de pagamento/ }).click();
  await page.getByRole('link', { name: 'Abrir página de pagamento' }).waitFor();
  assert.ok(amountCalls >= 3);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].provider, 'poseidon');
  assert.equal(requests[0].paymentMethod, 'pix');
});

test('PIX presents a labeled copy alternative and announces when the code and QR expire', { timeout: 18000 }, async t => {
  let expired = false;
  const page = await openFixture(t, { readPayment: () => expired
    ? { ...pixPayment, unavailable: true, code: null, qrUrl: null }
    : pixPayment });
  await page.goto(new URL(pixPath, checkoutUrl).href);
  const qr = page.getByRole('img', { name: 'QR Code para pagar este pedido via PIX' });
  const code = page.getByRole('textbox', { name: 'PIX copia e cola' });
  const copy = page.getByRole('button', { name: 'Copiar código PIX' });
  await qr.waitFor();
  assert.equal(await code.inputValue(), pixCode);
  assert.equal(await code.getAttribute('readonly'), '');
  assert.equal(await copy.isVisible(), true);
  await auditPaymentPage(page);

  expired = true;
  const verify = page.getByRole('button', { name: 'Já paguei — verificar pagamento' });
  await verify.press('Enter');
  await page.getByRole('alert').filter({ hasText: /Este PIX está vencido ou indisponível/ }).waitFor();
  assert.equal(await qr.count(), 0);
  assert.equal(await code.count(), 0);
  assert.equal(await copy.count(), 0);
  assert.equal(await verify.isEnabled(), true);
});

test('checkout restores the same request after a browser timeout and reload', { timeout: 18000 }, async t => {
  const requests = [];
  const page = await openFixture(t, { onOrder: route => {
    requests.push(route.request().postDataJSON());
    return requests.length === 1 ? route.abort('timedout') : route.fulfill({ json: { url: new URL(pixPath, checkoutUrl).href } });
  } });
  await page.goto(checkoutUrl+'?bio');
  const generate = page.getByRole('button', { name: 'Gerar PIX em nova guia' });
  await page.getByRole('textbox', { name: /Valor total da compra/ }).fill('99,89');
  await generate.click();
  await page.getByRole('alert').waitFor();
  assert.equal(requests.length, 1);
  assert.match(requests[0].requestId, /^[0-9a-f-]{36}$/);

  await page.reload();
  const recover = page.getByRole('button', { name: 'Recuperar o mesmo pedido' });
  await recover.click();
  await page.getByRole('link', { name: 'Abrir página de pagamento' }).waitFor();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});
