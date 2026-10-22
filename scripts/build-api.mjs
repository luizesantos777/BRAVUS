import { build } from 'esbuild';
await build({
  entryPoints: ['server/vercel.ts'], outfile: 'api/index.mjs',
  platform: 'node', target: 'node24', format: 'esm', bundle: true, packages: 'external',
  banner: { js: '// Generated from server/vercel.ts by npm run build:api. Do not edit directly.' },
  logLevel: 'info',
});
