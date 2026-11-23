import { spawn } from 'node:child_process';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ci = process.argv.includes('--ci');
const bundledNpm = process.platform === 'win32'
  ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  : null;

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? process.execPath : 'npm', [
      ...(bundledNpm ? [bundledNpm] : []),
      'run', script, ...(args.length ? ['--', ...args] : []),
    ], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
        WRANGLER_WRITE_LOGS: 'false',
        WRANGLER_LOG_PATH: '.wrangler/logs',
      },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} terminou com código ${code ?? 1}`)));
  });
}

// Local execution is intentionally deterministic: the media scanner checks the
// exact build produced moments earlier. CI fans these same checks out into
// independent jobs so build, lint and tests run concurrently there.
await run('build:portable');
await run('lint:portable');
await run('test:only');
await run('media:check:build');
await run('migration:check');
if (ci) console.log('Quality pipeline completed in CI mode.');
else console.log('Quality pipeline completed.');
