import { database } from './payments';

export type Partner = { slug: string; name: string; active: boolean };
export type PartnerError = { error: string; code: number };

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const cleanSlug = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const cleanName = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const validName = (name: string) => name.length >= 2 && name.length <= 100 && !/[\u0000-\u001f<>]/.test(name);

export async function listPartners(): Promise<Partner[]> {
  try {
    const rows = (await database().prepare('SELECT slug,name,active FROM partners ORDER BY created_at,slug').all()).results as Array<{ slug: string; name: string; active: number }>;
    return rows.map(r => ({ slug: r.slug, name: r.name, active: !!r.active }));
  } catch {
    return [];
  }
}

/** Resolve um link /p/<slug>: apenas parceiros ativos. */
export async function resolvePartner(slug: string | null | undefined): Promise<Partner | null> {
  if (!slug || !SLUG_RE.test(slug)) return null;
  try {
    const row = await database().prepare('SELECT slug,name,active FROM partners WHERE slug=?').bind(slug).first();
    return row && row.active ? { slug: row.slug, name: row.name, active: true } : null;
  } catch {
    return null;
  }
}

export async function createPartner(slugRaw: unknown, nameRaw: unknown): Promise<PartnerError | null> {
  const slug = cleanSlug(slugRaw), name = cleanName(nameRaw);
  if (!SLUG_RE.test(slug)) return { error: 'Identificador inválido. Use letras minúsculas, números ou hífen, de 2 a 40 caracteres.', code: 400 };
  if (!validName(name)) return { error: 'Informe um nome de parceiro com 2 a 100 caracteres.', code: 400 };
  const db = database(), now = Date.now();
  await db.prepare('INSERT INTO partners (slug,name,active,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(slug) DO NOTHING').bind(slug, name, 1, now, now).run();
  const row = await db.prepare('SELECT slug FROM partners WHERE slug=?').bind(slug).first();
  return row ? null : { error: 'Já existe um parceiro com esse identificador.', code: 409 };
}

export async function renamePartner(slugRaw: unknown, nameRaw: unknown): Promise<PartnerError | null> {
  const slug = cleanSlug(slugRaw);
  if (!SLUG_RE.test(slug)) return { error: 'Parceiro não encontrado.', code: 404 };
  const name = cleanName(nameRaw);
  if (!validName(name)) return { error: 'Informe um nome de parceiro com 2 a 100 caracteres.', code: 400 };
  const db = database();
  await db.prepare('UPDATE partners SET name=?,updated_at=? WHERE slug=?').bind(name, Date.now(), slug).run();
  return (await db.prepare('SELECT slug FROM partners WHERE slug=?').bind(slug).first()) ? null : { error: 'Parceiro não encontrado.', code: 404 };
}

export async function setPartnerActive(slugRaw: unknown, active: boolean): Promise<PartnerError | null> {
  const slug = cleanSlug(slugRaw);
  if (!SLUG_RE.test(slug)) return { error: 'Parceiro não encontrado.', code: 404 };
  const db = database();
  await db.prepare('UPDATE partners SET active=?,updated_at=? WHERE slug=?').bind(active ? 1 : 0, Date.now(), slug).run();
  return (await db.prepare('SELECT slug FROM partners WHERE slug=?').bind(slug).first()) ? null : { error: 'Parceiro não encontrado.', code: 404 };
}

export async function deletePartner(slugRaw: unknown): Promise<PartnerError | null> {
  const slug = cleanSlug(slugRaw);
  if (!SLUG_RE.test(slug)) return { error: 'Parceiro não encontrado.', code: 404 };
  const db = database();
  await db.prepare('DELETE FROM partners WHERE slug=?').bind(slug).run();
  return (await db.prepare('SELECT slug FROM partners WHERE slug=?').bind(slug).first()) ? { error: 'Não foi possível excluir. Tente novamente.', code: 500 } : null;
}