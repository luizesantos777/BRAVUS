import {cardPlan} from './card-pricing';
import {beeOrder,beeRequest} from './beehive';
import {credentials,database,json,PAYMENT_ORIGIN} from './payments';
import {InputError} from './firebot';
import {amountLimitMessage,fitsGatewayAmount,gatewayAmountLimits,gatewayCardPlans} from './gateway-amount-limits';
import {INVALID_CHECKOUT_AMOUNT} from './checkout-amount';
import {recordGatewayFailure} from './operational-health';
const record=(d:any)=>!d||d.success===false||d.error?null:(d.data??d);
export async function createBeehiveCard(b:any,_c:{token:string}){
 const db=database(),id=crypto.randomUUID();
 const hash='bravus-card-v1:'+b.amount+':'+(b.sellerName||'');
 const result=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'card_draft',Date.now(),'beehive_card',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 let orderId=id;
 if(!result.meta?.changes){const old=await db.prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(b.requestId).first();if(old?.provider!=='beehive_card'||old.payload_hash!==hash||(old.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados ou outra forma de pagamento.'},409);orderId=old.id;}
 return json({url:PAYMENT_ORIGIN+'/cartao/'+orderId,paymentMethod:'credit_card'});
}
function validate(d:any,row:any){if(!Number.isSafeInteger(d?.id)||d.id<=0||d.amount!==row.amount||d.paymentMethod!=='credit_card'||d.externalRef!==row.request_id||row.transaction_id&&String(d.id)!==row.transaction_id)throw Error('Invalid transaction');}
function state(d:any){
 if(d.status==='paid')return 'paid';
 if(['refused','canceled','cancelled','expired','refunded','chargedback'].includes(d.status))return 'card_'+d.status;
 return 'card_pending'; // authorized/processing must not be presented as paid
}
export async function syncCard(row:any){
 const c=await credentials('beehive');if(!c||!row.transaction_id)return false;
 const r=await beeRequest('/transactions/'+encodeURIComponent(row.transaction_id),c.token);if(!r.ok)return false;
 const d=record(await r.json());validate(d,{...row,amount:(await savedPlan(row)).amount});if(d.installments!==undefined&&d.installments!==await savedInstallments(row.id))throw Error('Installments mismatch');row.state=state(d);
 await database().prepare('UPDATE payment_orders SET state=? WHERE id=?').bind(row.state,row.id).run();return true;
}
async function savedInstallments(id:string){const saved=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('card_installments_'+id).first();const n=Number(saved?.value);return Number.isInteger(n)&&n>=1&&n<=12?n:1;}
async function savedPlan(row:any){const saved=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('card_plan_'+row.id).first();return saved?.value?JSON.parse(saved.value):cardPlan(row.amount,await savedInstallments(row.id),0);}
export async function cardInfo(row:any){
 if(row.transaction_id&&row.state!=='paid'&&row.checked_at<Date.now()-15000){const claim=await database().prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at=?').bind(Date.now(),row.id,row.checked_at).run();if(claim.meta?.changes)try{await syncCard(row);}catch{}}
 const c=await credentials('beehive');
 const plan=await savedPlan(row);
 const draft=row.state==='card_draft';
 const limits=draft?(await gatewayAmountLimits('beehive')).credit_card:null;
 const plans=draft?gatewayCardPlans(row.amount,limits):undefined;
 return json({plan:draft?null:plan,plans,amountError:plans?.length===0?(limits?amountLimitMessage(limits,'credit_card'):INVALID_CHECKOUT_AMOUNT):undefined,baseAmount:row.amount,installments:draft?null:await savedInstallments(row.id),amount:plan.amount,state:row.state,paid:row.state==='paid',publicKey:typeof c?.agent==='string'&&c.agent.startsWith('pk_live_')?c.agent:null});
}
export async function chargeCard(row:any,b:any,ip:string){
 // Accept only the provider's token. Raw PAN/CVV never belong in this API.
 if(b.card||b.number||b.cvv||b.pan||Object.keys(b).some(k=>!['cardToken','customer','installments','acceptedAmount'].includes(k)))return json({error:'Envie somente o token, os dados do comprador e o número de parcelas.'},400);
 if(row.state!=='card_draft')return cardInfo(row);
 const installments=b.installments===undefined?1:b.installments;
 if(!Number.isInteger(installments)||installments<1||installments>12)return json({error:'Selecione de 1 a 12 parcelas.'},400);
 if(typeof b.cardToken!=='string'||b.cardToken.length<10||b.cardToken.length>2048||/[^\x21-\x7e]/.test(b.cardToken)||/^\d+$/.test(b.cardToken))return json({error:'Não foi possível validar o cartão. Confira os dados e tente novamente.'},400);
 const plan=cardPlan(row.amount,installments);if(b.acceptedAmount!==plan.amount)return json({error:'Confira o total atualizado antes de pagar.',code:'CARD_QUOTE_CHANGED'},400);
 if(plan.installmentAmount<1)return json({error:'Selecione uma quantidade de parcelas compatível com este valor.',code:'AMOUNT_LIMIT'},400);
 const limits=(await gatewayAmountLimits('beehive')).credit_card;
 if(!fitsGatewayAmount(plan.amount,limits))return json({error:limits?amountLimitMessage(limits,'credit_card'):INVALID_CHECKOUT_AMOUNT,code:'AMOUNT_LIMIT'},400);
 const c=await credentials('beehive');if(!c)return json({error:'Pagamento temporariamente indisponível.'},503);
 let order;try{order=beeOrder({amount:plan.amount,requestId:row.request_id,customer:b.customer},ip);}catch(e){if(e instanceof InputError)return json({error:e.message},400);throw e;}
 const {pix,...base}=order;
 const payload={...base,paymentMethod:'credit_card',installments,card:{hash:b.cardToken}};
 const claim=await database().prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('card_processing',row.id,'card_draft').run();
 if(!claim.meta?.changes)return json({state:'card_processing',amount:row.amount,paid:false});
 let httpStatus:number|undefined;
 try{
  await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind('card_plan_'+row.id,JSON.stringify(plan)).run();
  await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind('card_installments_'+row.id,String(installments)).run();
  const r=await beeRequest('/transactions',c.token,payload);httpStatus=r.status;
  if(!r.ok)throw Error('Provider rejected');
  const d=record(await r.json());validate(d,{...row,amount:plan.amount});if(d.installments!==undefined&&d.installments!==installments)throw Error('Installments mismatch');
  row.state=state(d);
  await database().prepare('UPDATE payment_orders SET state=?,transaction_id=? WHERE id=?').bind(row.state,String(d.id),row.id).run();
  return json({plan,baseAmount:row.amount,installments,state:row.state,amount:plan.amount,paid:row.state==='paid'});
 }catch{
   await recordGatewayFailure('beehive',httpStatus??503);
  try{await database().prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('card_unconfirmed',row.id,'card_processing').run();}catch{}
  return json({plan,baseAmount:row.amount,installments,state:'card_unconfirmed',amount:plan.amount,paid:false,error:'Ainda não foi possível confirmar o resultado. Consulte o pagamento ou fale com o vendedor antes de tentar outra cobrança.'},502);
 }
}
