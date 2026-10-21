import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/** The process uses this credential normally; only its path is logged. */
export function loadAdminKey(filename: string, configured?: string): string {
  if (configured !== undefined) {
    if (configured.length < 32 || configured.length > 256) throw new Error('BRAVUS_ADMIN_KEY deve ter entre 32 e 256 caracteres.');
    return configured;
  }
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(filename, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  chmodSync(filename, 0o600);
  const key = readFileSync(filename, 'utf8').trim();
  if (key.length < 32 || key.length > 256) throw new Error('Arquivo da chave administrativa inválido; preserve-o e configure BRAVUS_ADMIN_KEY para recuperar o acesso.');
  return key;
}
