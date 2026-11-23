import { confirmedCheckoutSale, readCheckoutSaleProof } from '@/lib/checkout-portal-sales';
import { json } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('application/json') || !req.body) {
    return json({ error: 'Prova inválida.' }, 400);
  }
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512) {
        await reader.cancel();
        return json({ error: 'Prova inválida.' }, 400);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return json({ error: 'Prova inválida.' }, 400);
  }
  let proof;
  try { proof = readCheckoutSaleProof(JSON.parse(text)); } catch { proof = null; }
  if (!proof) return json({ error: 'Prova inválida.' }, 400);
  try {
    const sale = await confirmedCheckoutSale(proof);
    return sale ? json(sale) : json({ error: 'Pagamento confirmado não encontrado.' }, 404);
  } catch {
    return json({ error: 'Confirmação temporariamente indisponível.' }, 503);
  }
}
