import Checkout from '@/app/checkout/ui';
import { lookupCheckoutAttendant } from '@/lib/checkout-attendant';
import { BIOCAMISAS_BRAND } from '@/lib/checkout-brand';
import { currentCheckoutBrand } from '@/lib/checkout-context';
import { panelUnlocked } from '@/lib/gateway-access';

export const dynamic = 'force-dynamic';

function AttendantLinkMessage({ temporary = false }: { temporary?: boolean }) {
  return (
    <main className="pay-shell checkout-page">
      <section className="pay-card">
        <span className="secure">Link de pagamento</span>
        <h1>{temporary ? 'Link temporariamente indisponível' : 'Link não encontrado'}</h1>
        <p className="muted">
          {temporary
            ? 'Atualize esta página em alguns instantes para recuperar o link.'
            : 'Peça um link atualizado a quem fez o atendimento.'}
        </p>
      </section>
    </main>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let attendant;
  try {
    attendant = await lookupCheckoutAttendant(id);
  } catch {
    return <AttendantLinkMessage temporary />;
  }
  if (!attendant) return <AttendantLinkMessage />;

  const [brand, canConfigure] = await Promise.all([
    attendant.kind === 'partner' ? BIOCAMISAS_BRAND : currentCheckoutBrand(),
    panelUnlocked(),
  ]);
  return <Checkout key={attendant.id} brand={brand} canConfigure={canConfigure} attendant={attendant} />;
}
