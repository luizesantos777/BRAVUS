import Access from '@/app/admin/gateways/access';
import { panelUnlocked } from '@/lib/gateway-access';
import Vendas from './ui';

export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!await panelUnlocked()) return <Access />;
  return <Vendas />;
}