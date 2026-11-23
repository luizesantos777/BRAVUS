import {buck,database,json,PAYMENT_ORIGIN} from './payments';
import {buckFailure,recoverBuck} from './buckpay';
import {recordCreationRejection} from './gateway-failures';
import {paymentBuyerName} from './checkout-buyer-fields';

export async function createBuckpay(b:any){
 let id:string|undefined;
 try{
  const db=database(),existing=await db.prepare('SELECT id,amount,state,attendant_id FROM payment_orders WHERE request_id=?').bind(b.requestId).first();
  if(existing){
   if((existing.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado em outro checkout.',code:'ORDER_CHANGED'},409);
   if(existing.amount!==b.amount)return json({error:'Este pedido já foi iniciado com outro valor.'},409);
   if(existing.state==='ready'||existing.state==='paid')return json({url:PAYMENT_ORIGIN+'/pagar/'+existing.id});
   return recoverBuck(existing,b.sellerName);
  }
  id=crypto.randomUUID();await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,0,?,?,?)').bind(id,b.requestId,b.amount,'creating',Date.now(),b.sellerName,b.checkoutOrigin||null,b.attendantId??null).run();
  const buyerName=paymentBuyerName(b);
  const response=await buck('/v1/transactions',{method:'POST',body:JSON.stringify({external_id:id,payment_method:'pix',amount:b.amount,...(buyerName?{buyer:{name:buyerName}}:{})})});
  if(!response.ok){await recordCreationRejection(id,response);await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();return buckFailure(response,'create',[buyerName,b.sellerName].filter(Boolean));}
  const result=await response.json() as any,d=result.data;
  if(d?.total_amount!==b.amount||typeof d?.pix?.code!=='string'||!d.pix.code.startsWith('000201')||d.pix.code.length>4096||typeof d.pix.qrcode_base64!=='string')throw Error('Invalid provider data');
  const qr=d.pix.qrcode_base64.replace(/^data:image\/png;base64,/,'');if(!/^[A-Za-z0-9+/=]+$/.test(qr)||qr.length>500000)throw Error('Invalid QR');
  await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=? WHERE id=?').bind('ready',d.pix.code,qr,id).run();return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
 }catch{
  if(id)try{await database().prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();}catch{}
  return json({error:id?'Não foi possível confirmar o resultado. Confira a cobrança na BuckPay antes de iniciar outro pedido.':'Não foi possível gerar o link. Tente novamente.'},503);
 }
}
