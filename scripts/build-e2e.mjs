import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, VITE_MANUAL_SALES_TEST_MODE: 'true' };

function run(command, args, commandEnv = env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: commandEnv,
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npm, ['exec', '--', 'tsc', '--noEmit']);
run(npm, ['exec', '--', 'vite', 'build', '--mode', 'e2e']);
run(process.execPath, ['scripts/build-partner-html.mjs']);
run(npm, ['run', 'build:api']);

