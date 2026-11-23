import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = join(root, 'outputs');
await mkdir(outputDirectory, { recursive: true });
const reportProcess = spawnSync(process.execPath, [join(root, 'scripts', 'check-media.mjs'), '--dist', '--json'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
});
if (reportProcess.status !== 0) {
  process.stderr.write(reportProcess.stderr || reportProcess.stdout || 'A verificação de mídia falhou.\n');
  process.exit(reportProcess.status ?? 1);
}
const reportPath = join(outputDirectory, 'media-inventory.json');
await writeFile(reportPath, reportProcess.stdout);
const stamp = new Date().toISOString().slice(0, 10);
const archivePath = join(outputDirectory, `midia-checkout-${stamp}.tar.gz`);
execFileSync('tar', ['-czf', archivePath, 'public', 'ARQUIVOS-DE-MIDIA-OMITIDOS.txt', '-C', 'outputs', 'media-inventory.json'], { cwd: root, stdio: 'inherit' });
console.log(`Backup de mídia criado em ${archivePath}.`);
