import Checkout from '@/app/checkout/ui';
import { currentCheckoutBrand } from '@/lib/checkout-context';
import { panelUnlocked } from '@/lib/gateway-access';
import { resolvePartner } from '@/lib/partners';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await currentCheckoutBrand();
  const partner = await resolvePartner(slug);
  if (!partner) {
    return (
      <main className="pay-shell">
        <section className="pay-card" style={{ textAlign: 'center', padding: '2.5rem 1.25rem' }}>
          <span className="secure">Link de parceiro</span>
          <h1>Link não encontrado</h1>
          <p className="muted">Este link está inválido ou foi desativado. Fale com a Bravus para receber um novo link.</p>
          <p><a href="/checkout" style={{ fontWeight: 700 }}>Ir para o checkout</a></p>
        </section>
      </main>
    );
  }
  return <Checkout canConfigure={!!(await panelUnlocked())} brand={brand} partnerName={partner.name} />;
}