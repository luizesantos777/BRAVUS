import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const node = process.execPath;
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const persistRoot = await mkdtemp(join(root, '.wrangler', 'migration-check-'));

function apply() {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.local.json', '--persist-to', persistRoot], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_PATH: '.wrangler/logs' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Wrangler terminou com código ${code ?? 1}`)));
  });
}

try {
  await apply();
  const second = await apply();
  if (!/No migrations to apply/i.test(second.stdout)) throw new Error('A segunda execução não confirmou que as migrações já estavam aplicadas.');
  console.log('Migrações locais aplicadas e idempotência confirmada.');
} finally {
  await rm(persistRoot, { recursive: true, force: true });
}
