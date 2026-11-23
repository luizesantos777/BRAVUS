import { json, readBody } from '@/lib/payments';
import { panelGuard } from '@/lib/gateway-access';
import * as partners from '@/lib/partners';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const deny = await panelGuard(req);
  if (deny) return deny;
  try { return json({ partners: await partners.listPartners() }); } catch { return json({ error: 'Não foi possível carregar os parceiros.' }, 503); }
}

export async function POST(req: Request) {
  const deny = await panelGuard(req);
  if (deny) return deny;
  let body: any;
  try { body = await readBody(req); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  try {
    const r = await partners.createPartner(body?.slug, body?.name);
    return r ? json(r, r.code) : json({ ok: true });
  } catch { return json({ error: 'Não foi possível criar o parceiro. Tente novamente.' }, 503); }
}

export async function PUT(req: Request) {
  const deny = await panelGuard(req);
  if (deny) return deny;
  let body: any;
  try { body = await readBody(req); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  try {
    const r = await partners.renamePartner(body?.slug, body?.name);
    return r ? json(r, r.code) : json({ ok: true });
  } catch { return json({ error: 'Não foi possível renomear. Tente novamente.' }, 503); }
}

export async function PATCH(req: Request) {
  const deny = await panelGuard(req);
  if (deny) return deny;
  let body: any;
  try { body = await readBody(req); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  try {
    const r = await partners.setPartnerActive(body?.slug, body?.active === true);
    return r ? json(r, r.code) : json({ ok: true });
  } catch { return json({ error: 'Não foi possível atualizar. Tente novamente.' }, 503); }
}

export async function DELETE(req: Request) {
  const deny = await panelGuard(req);
  if (deny) return deny;
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  try {
    const r = await partners.deletePartner(slug);
    return r ? json(r, r.code) : json({ ok: true });
  } catch { return json({ error: 'Não foi possível excluir. Tente novamente.' }, 503); }
}