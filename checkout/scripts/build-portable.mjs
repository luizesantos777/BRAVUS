import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const timeoutText = process.env.SITES_BUILD_TIMEOUT ?? '3m';
const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(timeoutText);
if (!match) throw new Error('SITES_BUILD_TIMEOUT deve ser uma duração como 3m.');
const multiplier = { '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const timeout = Number(match[1]) * multiplier[match[2]];
if (!Number.isSafeInteger(timeout) || timeout < 1000) throw new Error('SITES_BUILD_TIMEOUT inválido.');

const child = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'build', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS ?? 'false',
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? '.wrangler/logs',
  },
  windowsHide: true,
});

let stopped = false;
const timer = setTimeout(() => {
  stopped = true;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), Number(process.env.SITES_BUILD_KILL_AFTER_MS ?? 10_000)).unref();
}, timeout);

child.once('error', error => {
  clearTimeout(timer);
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  clearTimeout(timer);
  if (stopped) {
    console.error(`O build Vinext excedeu SITES_BUILD_TIMEOUT=${timeoutText}.`);
    process.exitCode = 124;
    return;
  }
  process.exitCode = code ?? (signal ? 1 : 0);
});
