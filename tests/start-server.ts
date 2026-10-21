import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PortalStore } from '../server/store.ts';
import { createPortalServer } from '../server/http.ts';

const directory = mkdtempSync(join(tmpdir(), 'bravus-browser-'));
const store = new PortalStore(join(directory, 'portal.sqlite'));
for (const platform of ['desktop', 'mobile']) {
  store.createAttendant(`Atendente ${platform}`, 1000, 20000, `fixture_${platform}_primary_01234567890123456789`);
  store.createAttendant(`Outro ${platform}`, 1000, 20000, `fixture_${platform}_other_01234567890123456789`);
}
const server = createPortalServer(store, { staticDir: resolve('dist'), adminKey: 'fixture_browser_admin_012345678901234567890123456789' });
server.listen(4173, '127.0.0.1', () => console.log('Servidor temporário dos testes do portal disponível.'));
const close = () => server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); process.exit(0); });
process.on('SIGTERM', close); process.on('SIGINT', close);
