import {readBeehive} from '@/lib/beehive';
import {readAtlasPayment} from '@/lib/atlas';
import {readElevaPayment} from '@/lib/eleva';
import {refreshGestaoPayment} from '@/lib/gestao';
import {refreshBuckPayment} from '@/lib/buckpay';
import {readPoseidonPayment} from '@/lib/poseidon';
import {json,database,validId} from '@/lib/payments';
export const dynamic='force-dynamic';
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){const {id}=await ctx.params;if(!validId(id))return json({error:'Pagamento não encontrado.'},404);try{const db=database();const row=await db.prepare('SELECT id,request_id,amount,state,pix_code,qr,checked_at,provider,transaction_id,seller_name,attendant_id FROM payment_orders WHERE id=?').bind(id).first();if(!row||!row.pix_code&&!['paid','test_paid'].includes(row.state)&&!(row.provider==='atlas'&&row.transaction_id))return json({error:'Pagamento não encontrado ou indisponível.'},404);
if(row.provider==='beehive')return await readBeehive(row);
if(row.provider==='atlas')return await readAtlasPayment(row);
if(row.provider==='eleva')return await readElevaPayment(row);
if(row.provider==='gestao'){
 await refreshGestaoPayment(row);
 return json({amount:row.amount,paid:row.state==='paid',code:row.state==='paid'?null:row.pix_code,qrUrl:row.state==='paid'?null:row.qr,provider:'gestao',canVerify:true});
}
if(row.provider==='poseidon')return await readPoseidonPayment(row);
if(row.provider==='firebot')return json({amount:row.amount,paid:false,code:row.pix_code,qrUrl:row.qr,provider:row.provider,canVerify:false});
if(row.provider==='buckpay')await refreshBuckPayment(row);
return json({amount:row.amount,paid:row.state==='paid',code:row.state==='paid'?null:row.pix_code,canVerify:row.provider==='buckpay',...(typeof row.qr==='string'&&row.qr.startsWith('data:image/')?{qrUrl:row.state==='paid'?null:row.qr}:{qr:row.state==='paid'?null:row.qr})});}catch{return json({error:'Pagamento temporariamente indisponível. Tente novamente.'},503);}}

