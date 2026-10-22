import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
let html = await readFile(path.join(dist, 'index.html'), 'utf8');
const scriptTag = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const styleTag = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
assert(scriptTag && styleTag, 'Expected a production JavaScript bundle and stylesheet.');
const script = await readFile(path.join(dist, scriptTag[1]), 'utf8');
const style = await readFile(path.join(dist, styleTag[1]), 'utf8');
assert(!/\bimport\s*(?:\(|['"])/.test(script), 'The Pages build must have no external module imports.');
assert(!/<\/script/i.test(script) && !/<\/style/i.test(style), 'Unsafe inline asset boundary.');
html = html.replace(scriptTag[0], () => `<script type="module">\n${script}\n</script>`);
html = html.replace(styleTag[0], () => `<style>\n${style}\n</style>`);
const favicon = await readFile(path.join(dist, 'favicon.svg'));
html = html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${favicon.toString('base64')}"`);
html = html.replace('href="/apple-touch-icon.png"', 'href="./apple-touch-icon.png"').replace('href="/manifest.webmanifest"', 'href="./manifest.webmanifest"');
await mkdir(path.join(root, 'docs'), { recursive: true });
await writeFile(path.join(root, 'docs/index.html'), html);
await writeFile(path.join(root, 'docs/.nojekyll'), '');
await writeFile(path.join(root, 'docs/notifications-worker.js'), await readFile(path.join(dist, 'notifications-worker.js')));
await writeFile(path.join(root, 'docs/favicon.svg'), favicon);
for (const filename of ['manifest.webmanifest', 'admin.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'firebot-apple-touch-icon.png', 'firebot-icon-192.png', 'firebot-icon-512.png']) {
  await writeFile(path.join(root, 'docs', filename), await readFile(path.join(dist, filename)));
}
console.log('GitHub Pages build ready in docs/: self-contained HTML and .nojekyll.');
