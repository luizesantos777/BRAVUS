import {database,json,publicGuard,readBody,validId} from '@/lib/payments';
import {cardInfo,chargeCard} from '@/lib/beehive-card';
export const dynamic='force-dynamic';
async function order(id:string){if(!validId(id))return null;const r=await database().prepare('SELECT * FROM payment_orders WHERE id=?').bind(id).first();return r?.provider==='beehive_card'?r:null;}
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){try{const row=await order((await ctx.params).id);return row?cardInfo(row):json({error:'Pedido não encontrado.'},404);}catch{return json({error:'Não foi possível consultar o pedido.'},503);}}
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){const deny=await publicGuard(req);if(deny)return deny;try{const row=await order((await ctx.params).id);if(!row)return json({error:'Pedido não encontrado.'},404);return await chargeCard(row,await readBody(req),req.headers.get('cf-connecting-ip')||'');}catch{return json({error:'Não foi possível processar a solicitação. Consulte o pedido antes de tentar novamente.'},503);}}
