import { readFile, writeFile } from 'node:fs/promises';
import { renderPageMetadata } from '../src/page-metadata.ts';

const index = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const partner = renderPageMetadata(index, 'partner').replace('<html lang="pt-BR">', '<html lang="pt-BR" data-portal-entry="partner">');
await writeFile(new URL('../dist/parceiro.html', import.meta.url), partner);
