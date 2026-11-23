import {createPayment,validatePaymentInput} from './create-payment';
import {InputError} from './firebot';
import {InputError as PhysicalInputError} from './poseidon';
import {credentials,database,json,PAYMENT_ORIGIN,saveCredentials} from './payments';
import {backendCustomer,BeehiveBuyerDetailsRequired,VERIFIED_FALLBACK_BUYER} from './beehive';
import {gatewayEnabled} from './gateway-status';
import {atlasRejectedPayment} from './atlas-errors';
import {isConfirmedRejection} from './gateway-failures';
import {fallbackPolicy,gatewayHealth,markGatewayFailure,switchGatewayAutomatically,isGateway,gateways} from './gateways';
import type {FallbackPolicy,Gateway,GatewaySelection} from './gateways';
import type {CheckoutAttendant} from './checkout-attendant';
import {amountLimitResponse,gatewayAmountCheck} from './gateway-amount-limits';

type Attempt={provider:Gateway;requestId:string;outcome:'pending'|'rejected'|'skipped'|'ready'|'unconfirmed'};
type Intent={version:1;hash:string;state:'running'|'complete'|'failed'|'unconfirmed';providers:Gateway[];index:number;attempts:Attempt[];selection:GatewaySelection;byTicket:boolean;lease:string;leaseUntil:number;createdAt:number;attendant?:CheckoutAttendant;checkoutOrigin?:string};
type Saved={key:string;raw:string;value:Intent};
const keyFor=(id:string)=>'gateway_fallback_order:'+id;
const inProgress=()=>json({error:'Este pedido está sendo processado. Aguarde e recupere o mesmo pedido.',code:'PAYMENT_PROCESSING'},409);
function canonical(value:any):any{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}
async function fingerprint(b:any){
 const identity=canonical({amount:b.amount,sellerName:b.sellerName||null,paymentMethod:b.paymentMethod||'pix',customer:b.customer||{},shipping:b.shipping||{},storeOrder:b.storeOrder===true,...(b.attendantId?{attendantId:b.attendantId}:{})});
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity))))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function readFallbackRequest(id:string):Promise<Saved|null>{
 const key=keyFor(id),row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind(key).first();
 if(!row)return null;
 const value=JSON.parse(row.value) as Intent;
 if(value.version!==1||typeof value.hash!=='string'||!Array.isArray(value.attempts)||value.attempts.length>gateways.length)throw Error('Invalid fallback request');
 return {key,raw:row.value,value};
}
async function paymentRow(requestId:string){return database().prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(requestId).first();}
const resultFor=(row:any)=>json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});
async function nextAvailable(intent:Intent,start:number){
 for(let index=start;index<intent.providers.length;index++){
  const provider=intent.providers[index],health=await gatewayHealth(provider);
  if(await gatewayEnabled(provider)&&(!health||health.epoch!==intent.selection.epoch||health.failedUntil<=Date.now()))return provider;
 }
 return null;
}
async function changeFutureGateway(intent:Intent,provider:Gateway,reason:'rejected'|'unconfirmed',preferred?:Gateway){
 await markGatewayFailure(provider,reason,intent.selection.epoch);
 const current=await fallbackPolicy();if(!current.enabled||!current.autoSwitch)return;
 const next=preferred??await nextAvailable(intent,intent.index+1);if(!next)return;
 if(!intent.byTicket)await switchGatewayAutomatically(intent.selection,next,reason);
 else await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('gateway_last_switch',JSON.stringify({from:provider,to:next,reason,scope:'ticket',at:Date.now()})).run();
}

export async function runPaymentFallback(b:any,ip:string,policy:FallbackPolicy,route:{provider:Gateway;selection:GatewaySelection;byTicket:boolean},saved:Saved|null){
 const hash=await fingerprint(b),key=keyFor(b.requestId),db=database();
 if(!saved){
  // Validation errors do not reserve a request ID; the buyer can correct the form.
  await validatePaymentInput(b,route.provider,ip);
  const providers=[...new Set([route.provider,...policy.order])];
  const value:Intent={version:1,hash,state:'running',providers,index:0,attempts:[],selection:route.selection,byTicket:route.byTicket,lease:crypto.randomUUID(),leaseUntil:Date.now()+180000,createdAt:Date.now(),...(b.attendantId?{attendant:{id:b.attendantId,name:b.sellerName},checkoutOrigin:b.checkoutOrigin}:{})};
  const raw=JSON.stringify(value),claim=await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind(key,raw).run();
  if(claim.meta?.changes)saved={key,raw,value};
  else{saved=await readFallbackRequest(b.requestId);if(!saved)return inProgress();}
  if(saved.raw!==raw)return runPaymentFallback(b,ip,policy,route,saved);
 }else{
  if(saved.value.hash!==hash)return json({error:'Este pedido já foi iniciado com outros dados. Recupere a cobrança original.',code:'ORDER_CHANGED'},409);
  const attempt=saved.value.attempts.at(-1),row=attempt?await paymentRow(attempt.requestId):null;
  if(row&&(row.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado em outro checkout.',code:'ORDER_CHANGED'},409);
  if(row&&(['ready','paid','test_paid'].includes(row.state)||saved.value.state==='complete'))return resultFor(row);
  if(saved.value.state==='complete')return inProgress();
  if(saved.value.state==='failed')return row?.provider==='atlas'&&row.state==='rejected'?atlasRejectedPayment(row.id):json({error:'As gateways de reserva não puderam gerar este PIX. Contate o responsável.',code:'FALLBACK_EXHAUSTED'},503);
  if(saved.value.leaseUntil>Date.now())return inProgress();
  const next={...saved.value,lease:crypto.randomUUID(),leaseUntil:Date.now()+180000};
  const raw=JSON.stringify(next),claim=await db.prepare('UPDATE payment_settings SET value=? WHERE key=? AND value=?').bind(raw,key,saved.raw).run();
  if(!claim.meta?.changes)return inProgress();saved={key,raw,value:next};
 }
 let raw=saved.raw,intent=saved.value;
 let customer=b.customer;
 async function persist(){
  const next=JSON.stringify(intent),change=await db.prepare('UPDATE payment_settings SET value=? WHERE key=? AND value=?').bind(next,key,raw).run();
  if(!change.meta?.changes)throw Error('Fallback lease lost');raw=next;
 }
 try{
  if(intent.providers[0]==='beehive'){
   // The simplified Beehive form sends a registered name. Reserves must receive
   // that same complete customer, never the name-only browser payload.
   const snapshotKey='gateway_fallback_customer:'+b.requestId;
   let snapshot=await credentials(snapshotKey);
   if(!snapshot){
    const first=intent.attempts[0],previous=first?await paymentRow(first.requestId):null;
    customer=await backendCustomer(b,previous?.provider==='beehive'?previous:null);
    await saveCredentials(JSON.stringify(customer),'',snapshotKey);snapshot=await credentials(snapshotKey);
   }
   customer=JSON.parse(snapshot.token);
  }
  while(intent.index<intent.providers.length){
   const provider=intent.providers[intent.index];
   let attempt=intent.attempts[intent.index];
   if(!attempt){
    const current=await fallbackPolicy(),health=await gatewayHealth(provider);
    // Removing a reserve or disabling fallback stops additional outbound attempts.
    if(intent.index>0&&(!current.enabled||!current.order.includes(provider)||!await gatewayEnabled(provider)||(health?.epoch===intent.selection.epoch&&health.failedUntil>Date.now()))){
     intent.attempts.push({provider,requestId:crypto.randomUUID(),outcome:'skipped'});intent.index++;await persist();continue;
    }
    attempt={provider,requestId:intent.index===0?b.requestId:crypto.randomUUID(),outcome:'pending'};intent.attempts.push(attempt);await persist();
   }
   const payload={...b,customer,...(intent.providers[0]==='beehive'?{[VERIFIED_FALLBACK_BUYER]:customer}:{}),requestId:attempt.requestId,provider};
   let row=await paymentRow(attempt.requestId);
   if(row&&(row.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado em outro checkout.',code:'ORDER_CHANGED'},409);
   if(row&&row.provider!==provider){
    // A request started just before routing was enabled may already be claimed.
    // It must be recovered through that adapter, never sent to another provider.
    intent.state='unconfirmed';intent.leaseUntil=0;await persist();
    if(!isGateway(row.provider))return json({error:'Este pedido já usa outra forma de pagamento.',code:'ORDER_CHANGED'},409);
    return createPayment(payload,row.provider,ip);
   }
   if(row&&['ready','paid','test_paid'].includes(row.state)){attempt.outcome='ready';intent.state='complete';intent.leaseUntil=0;await persist();return resultFor(row);}
   if(await isConfirmedRejection(row)){attempt.outcome='rejected';await markGatewayFailure(provider,'rejected',intent.selection.epoch);intent.index++;await persist();continue;}
   if(attempt.outcome==='skipped'||attempt.outcome==='rejected'){intent.index++;await persist();continue;}
   if(!row){
    const current=await fallbackPolicy();
    if(intent.index>0&&(!current.enabled||!current.order.includes(provider))){attempt.outcome='skipped';intent.index++;await persist();continue;}
    const amountCheck=await gatewayAmountCheck(provider,'pix',payload.amount);
    if(amountCheck.status==='outside_limits'){
     if(intent.index===0){await db.prepare('DELETE FROM payment_settings WHERE key=? AND value=?').bind(key,raw).run();return amountLimitResponse(amountCheck);}
     attempt.outcome='skipped';intent.index++;await persist();continue;
    }
    try{await validatePaymentInput(payload,provider,ip);}
    catch(error){
     if(!(error instanceof InputError||error instanceof PhysicalInputError))throw error;
     if(intent.index===0){await db.prepare('DELETE FROM payment_settings WHERE key=? AND value=?').bind(key,raw).run();return json({error:error.message,...(error instanceof BeehiveBuyerDetailsRequired?{code:'BUYER_DETAILS_REQUIRED'}:{})},400);}
     attempt.outcome='skipped';intent.index++;await persist();continue;
    }
   }
   let response:Response;
   try{response=await createPayment(payload,provider,ip);}
   catch(error){
    if(error instanceof InputError||error instanceof PhysicalInputError)response=json({error:error.message},400);else throw error;
   }
   row=await paymentRow(attempt.requestId);
   if(row&&(row.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado em outro checkout.',code:'ORDER_CHANGED'},409);
   if(row&&['ready','paid','test_paid'].includes(row.state)){
    attempt.outcome='ready';intent.state='complete';intent.leaseUntil=0;await persist();
    if(intent.index>0&&policy.autoSwitch){const failed=intent.attempts.find(item=>item.outcome==='rejected');if(failed)await changeFutureGateway(intent,failed.provider,'rejected',provider).catch(()=>{});}
    return resultFor(row);
   }
   if(await isConfirmedRejection(row)){
    attempt.outcome='rejected';await markGatewayFailure(provider,'rejected',intent.selection.epoch);intent.index++;await persist();continue;
   }
   if(!row){
    // A provider adapter always persists its claim before sending a transaction.
    if(response.status===400&&intent.index===0){await db.prepare('DELETE FROM payment_settings WHERE key=? AND value=?').bind(key,raw).run();return response;}
    attempt.outcome='skipped';intent.index++;await persist();continue;
   }
   if(row.state==='rejected'){
    // Buyer-data rejection is not an infrastructure failure.
    intent.state='failed';intent.leaseUntil=0;await persist();return response;
   }
   attempt.outcome='unconfirmed';intent.state='unconfirmed';intent.leaseUntil=0;await persist();
   await changeFutureGateway(intent,provider,'unconfirmed').catch(()=>{});
   return json({error:'O resultado deste PIX ainda não foi confirmado. Recupere o mesmo pedido; ele não será reenviado a outra gateway.',code:'PAYMENT_UNCONFIRMED'},response.status===409?409:502);
  }
  intent.state='failed';intent.leaseUntil=0;await persist();
  return json({error:'As gateways de reserva não puderam gerar este PIX. Contate o responsável.',code:'FALLBACK_EXHAUSTED'},503);
 }catch{
  // A lost database connection or lease cannot authorize a second provider.
  return json({error:'Não foi possível confirmar o processamento. Aguarde e recupere o mesmo pedido.',code:'PAYMENT_PROCESSING'},503);
 }
}
