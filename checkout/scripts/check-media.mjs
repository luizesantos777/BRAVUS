import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { BIOCAMISAS_ORIGINS, BRAVUS_PAYMENT_ORIGIN } from '../lib/checkout-brand.ts';

const omittedFile = 'ARQUIVOS-DE-MIDIA-OMITIDOS.txt';
const sourceDirectories = ['app', 'components', 'lib', 'legacy', 'public', 'worker'];
const localOrigins = new Set([BRAVUS_PAYMENT_ORIGIN, ...BIOCAMISAS_ORIGINS]);
const mediaExtension = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp|pdf)$/i;
const sourceExtension = /\.(?:[cm]?[jt]sx?|html|css|json)$/i;
const mediaUrl = /(?:^|[\s"'`(=,])((?:https?:\/\/|\/\/|\/(?!\/)|\.{1,2}\/|assets\/|catalogo\/)[^"'`()\s<>{},?#]+\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp|pdf)(?:[?#][^"'`()\s<>{},]*)?)(?=$|[\s"'`),<>])/gim;

async function filesUnder(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function assetPath(url, source) {
  const absolute = url.startsWith('/') || /^https?:\/\//i.test(url);
  const isPublic = source.startsWith('public/');
  if (!absolute && !isPublic && !source.startsWith('legacy/') && url.startsWith('.')) {
    return posix.join(posix.dirname(source), url.split(/[?#]/, 1)[0]);
  }
  const base = isPublic ? source.slice('public'.length) : '/';
  const resolved = new URL(url, new URL(base, BRAVUS_PAYMENT_ORIGIN));
  if (!localOrigins.has(resolved.origin)) return null;
  const pathname = decodeURIComponent(resolved.pathname);
  if (pathname.includes('\\') || pathname.split('/').includes('..')) throw new Error('Caminho de mídia inválido');
  return `public${pathname}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function inspectMedia(compareBuild) {
  const omitted = new Set();
  const lines = (await readFile(omittedFile, 'utf8')).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const path = line.trim().replace(/^bravus-brasil\//, '');
    if (!path) continue;
    if (!path.startsWith('public/') || !mediaExtension.test(path) || posix.normalize(path) !== path) {
      throw new Error(`Caminho inválido em ${omittedFile}:${index + 1}`);
    }
    omitted.add(path);
  }

  const files = new Set((await Promise.all(sourceDirectories.map(filesUnder))).flat());
  const references = new Map();
  const problems = [];
  for (const file of files) {
    if (!sourceExtension.test(file)) continue;
    const contents = await readFile(file, 'utf8');
    const locations = contents.split(/\r?\n/);
    for (const [index, line] of locations.entries()) {
      for (const [, url] of line.matchAll(mediaUrl)) {
        const location = `${file}:${index + 1}`;
        let path;
        try {
          path = assetPath(url, file);
        } catch {
          problems.push({ reason: 'referência de mídia inválida', path: location, sources: [] });
          continue;
        }
        if (!path) continue;
        const sources = references.get(path) ?? new Set();
        sources.add(location);
        references.set(path, sources);
      }
    }
  }

  const publicMedia = [...files].filter(path => path.startsWith('public/') && mediaExtension.test(path));
  const expected = [...new Set([...omitted, ...references.keys(), ...publicMedia])].sort();
  const builtFiles = compareBuild ? new Set(await filesUnder('dist/client')) : null;
  const inventory = [];
  for (const path of expected) {
    const sources = [...(references.get(path) ?? [])];
    if (!files.has(path)) {
      problems.push({ reason: 'arquivo ausente', path, sources });
      continue;
    }
    const bytes = await readFile(path);
    if (bytes.length === 0) problems.push({ reason: 'arquivo vazio', path, sources });
    const hash = sha256(bytes);
    inventory.push({ path, size: bytes.length, sha256: hash, sources, listed: omitted.has(path) });
    if (builtFiles && path.startsWith('public/')) {
      const builtPath = `dist/client/${path.slice('public/'.length)}`;
      if (!builtFiles.has(builtPath)) {
        problems.push({ reason: 'arquivo ausente no build', path: builtPath, sources });
      } else if (hash !== sha256(await readFile(builtPath))) {
        problems.push({ reason: 'conteúdo divergente no build', path: builtPath, sources });
      }
    }
  }
  return { listedCount: omitted.size, referencedCount: references.size, compareBuild, inventory, problems };
}

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dist' && arg !== '--json')) {
  console.error('Uso: node scripts/check-media.mjs [--dist] [--json]');
  process.exitCode = 2;
} else {
  const report = await inspectMedia(args.includes('--dist'));
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const { reason, path, sources } of report.problems) {
      const referencedBy = sources.length ? ` (${sources.join(', ')})` : '';
      console.error(`${reason} — ${path}${referencedBy}`);
    }
    const build = report.compareBuild ? ' e no build' : '';
    console.log(`${report.inventory.length} arquivos verificados na origem${build}. ${report.listedCount} na lista histórica, ${report.referencedCount} com referências estáticas.`);
  }
  process.exitCode = Number(report.problems.length > 0);
}
