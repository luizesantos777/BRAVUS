import Access from '@/app/admin/gateways/access';
import {panelUnlocked} from '@/lib/gateway-access';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {isOwner} from '@/lib/payments';
import Orders from './ui';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/admin/loja');if(!await isOwner())return <main className="pay-shell"><h1>Acesso restrito</h1><p>Entre com a conta proprietária para consultar pedidos.</p></main>;if(!await panelUnlocked())return <Access/>;return <Orders/>;}
