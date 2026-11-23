import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../scripts/check-media.mjs', import.meta.url));

async function fixture(t, files) {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(temporaryRoot, 'checkout-media-')));
  assert.equal(dirname(directory), temporaryRoot);
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return directory;
}

test('inventaria referências locais e confere os arquivos distribuídos pelo build', async t => {
  const directory = await fixture(t, {
    'ARQUIVOS-DE-MIDIA-OMITIDOS.txt': 'bravus-brasil/public/assets/cabecalho.webp\n',
    'app/page.tsx': '<img src="/assets/cabecalho.webp" alt="Cabeçalho" />',
    'legacy/funnel.html': '<a href="https://pagamento.bravuspix.shop/catalogo/cores%20atuais.pdf?v=1">Catálogo</a>',
    'public/funnel.css': 'header { background-image: url(./assets/cabecalho.webp); }',
    'public/assets/cabecalho.webp': 'fixture de imagem',
    'public/catalogo/cores atuais.pdf': 'fixture de catálogo',
    'dist/client/assets/cabecalho.webp': 'fixture de imagem',
    'dist/client/catalogo/cores atuais.pdf': 'fixture de catálogo',
  });
  const report = JSON.parse(execFileSync(process.execPath, [script, '--dist', '--json'], { cwd: directory, encoding: 'utf8' }));
  assert.equal(report.listedCount, 1);
  assert.equal(report.referencedCount, 2);
  assert.deepEqual(report.inventory.map(file => [file.path, file.sources]), [
    ['public/assets/cabecalho.webp', ['app/page.tsx:1', 'public/funnel.css:1']],
    ['public/catalogo/cores atuais.pdf', ['legacy/funnel.html:1']],
  ]);
  assert.ok(report.inventory.every(file => /^[a-f\d]{64}$/.test(file.sha256)));
  assert.deepEqual(report.problems, []);
});

test('distingue catálogos ausentes, mídia alterada pelo build e referências externas', async t => {
  const directory = await fixture(t, {
    'ARQUIVOS-DE-MIDIA-OMITIDOS.txt': 'bravus-brasil/public/assets/logo.jpg\n',
    'legacy/funnel.html': '<a href="https://biocamisas.shop/catalogo/faltando.pdf?ref=1">Catálogo</a>\n<img src="https://cdn.example.com/fora.png">',
    'public/assets/logo.jpg': 'fixture de imagem',
    'dist/client/assets/logo.jpg': 'fixture de imagem alterada',
  });
  assert.throws(() => execFileSync(process.execPath, [script, '--dist', '--json'], { cwd: directory, encoding: 'utf8' }), error => {
    assert.equal(error.status, 1);
    assert.deepEqual(JSON.parse(error.stdout).problems, [
      { reason: 'conteúdo divergente no build', path: 'dist/client/assets/logo.jpg', sources: [] },
      { reason: 'arquivo ausente', path: 'public/catalogo/faltando.pdf', sources: ['legacy/funnel.html:1'] },
    ]);
    return true;
  });
});
