import QRCode from 'qrcode/lib/browser';
import {credentials,database,json,PAYMENT_ORIGIN,saveCredentials} from './payments';
import {notifyPortalSale} from './sales-webhook';
import {documentValid,InputError} from './firebot';
import {recordCreationRejection} from './gateway-failures';
import {recordGatewayFailure} from './operational-health';
import {checkoutBrandForOrigin} from './checkout-brand';
import {INVALID_CHECKOUT_AMOUNT,isCheckoutAmount} from './checkout-amount';
import {atlasFailure,atlasFailureResponse,atlasRejectedPayment,saveAtlasFailure} from './atlas-errors';
import type {AtlasFailure} from './atlas-errors';

export const ATLAS_ORIGIN='https://atlaspags.com/api/v1';
type Credential={token:string;agent:string};
const auth=(c:Credential)=>({Authorization:'Bearer '+c.token,Accept:'application/json'});
export const atlasKeyValid=(key:unknown):key is string=>typeof key==='string'&&key.length<=1024&&/^atlas_sk_(live|test)_[\x21-\x7e]+$/.test(key);
export const atlasWebhookKeyValid=(key:unknown):key is string=>typeof key==='string'&&key.length<=1024&&/^whsec_[\x21-\x7e]+$/.test(key);
const live=(c:Credential)=>c.token.startsWith('atlas_sk_live_');
const metaKey=(id:string)=>'atlas_charge:'+id;
const payloadKey=(id:string)=>'atlas_payload:'+id;
const link=(id:string)=>json({url:PAYMENT_ORIGIN+'/pagar/'+id});
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export class AtlasSetupError extends Error {}

export async function activateAtlas(token:string,webhookSecret?:string){
 const c={token,agent:webhookSecret||''};
 let r:Response;
 try{r=await fetch(ATLAS_ORIGIN+'/charges?limit=1',{headers:auth(c),redirect:'manual',signal:AbortSignal.timeout(15000)});}
 catch{throw new AtlasSetupError('Não foi possível conectar à Atlas Pags. Tente novamente.');}
 if(r.status===401)return false;
 if(r.status===403)throw new AtlasSetupError('A Atlas recusou o acesso (HTTP 403). Confira a verificação da conta e as permissões da chave.');
 if(r.status===429)throw new AtlasSetupError('A Atlas limitou as consultas. Aguarde o prazo indicado no painel Atlas antes de tentar novamente.');
 if(!r.ok)throw new AtlasSetupError('A consulta da Atlas retornou HTTP '+r.status+'. Nenhuma cobrança foi criada.');
 let d:any;try{d=await r.json();}catch{throw new AtlasSetupError('A Atlas não retornou uma resposta JSON válida.');}
 if(d?.object!=='list'||!Array.isArray(d.data)||typeof d.has_more!=='boolean')throw new AtlasSetupError('A Atlas não retornou a lista de cobranças esperada.');
 const previous=await credentials('atlas');
 await saveCredentials(token,webhookSecret===undefined?previous?.agent||'':webhookSecret,'atlas');
 return true;
}

export function atlasOrder(b:any,ip=''){
 if(!isCheckoutAmount(b.amount))throw new InputError(INVALID_CHECKOUT_AMOUNT);
 const c=b.customer||{},name=typeof c.name==='string'?c.name.trim():'',email=typeof c.email==='string'?c.email.trim():'';
 const document=typeof c.cpf==='string'?c.cpf.replace(/\D/g,''):'';
 const phone=typeof c.phone==='string'?c.phone.trim():'';
 if(name.length<2||name.length>120||/[\x00-\x1f<>]/.test(name))throw new InputError('Informe o nome completo do comprador para a Atlas Pags (até 120 caracteres).');
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||/[\x00-\x1f<>]/.test(email))throw new InputError('Informe um e-mail válido do comprador para a Atlas Pags.');
 if(!documentValid(document))throw new InputError('Informe um CPF ou CNPJ válido do comprador para a Atlas Pags.');
 if(phone&&(phone.length>30||!/^\+?[\d ()-]{8,30}$/.test(phone)))throw new InputError('Confira o telefone com DDD do comprador.');
 const brand=checkoutBrandForOrigin(typeof b.checkoutOrigin==='string'?b.checkoutOrigin:null);
 return {amount:b.amount/100,method:'pix',customer:{name,email,document,...(phone?{phone}:{}),...(ip.length<=45&&/^[\da-fA-F:.]+$/.test(ip)?{ip}:{})},description:'Pedido '+brand.name,external_id:b.requestId,checkout_url:brand.origin+'/checkout'};
}

/** The response must belong to this exact order and environment before it can change a balance. */
export function atlasResult(d:any,row:{amount:number;request_id:string;transaction_id?:string|null},livemode:boolean){
 if(!d||typeof d!=='object'||typeof d.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(d.id)||typeof d.amount!=='number'||!Number.isFinite(d.amount)||Math.abs(d.amount*100-row.amount)>0.001||d.external_id!==row.request_id||d.livemode!==livemode||row.transaction_id&&d.id!==row.transaction_id||d.method!==undefined&&d.method!=='pix')throw Error('Invalid Atlas charge identity');
 const states:Record<string,string>={pending:'ready',paid:livemode?'paid':'test_paid',failed:'failed',expired:'expired',refunded:'refunded',chargeback:'chargeback'};
 if(typeof d.status!=='string'||!Object.hasOwn(states,d.status))throw Error('Invalid Atlas charge status');
 const expiresAt=typeof d.pix?.expires_at==='string'&&Number.isFinite(Date.parse(d.pix.expires_at))?d.pix.expires_at:null;
 const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&Math.abs(v*100-Math.round(v*100))<0.001;
 return {state:states[d.status],expiresAt,livemode,...(money(d.fee)?{fee:d.fee}:{}),...(money(d.net_amount)?{netAmount:d.net_amount}:{}),...(money(d.refunded)?{refunded:d.refunded}:{})};
}

async function saveCharge(row:any,d:any,livemode:boolean,lease?:number){
 const info=atlasResult(d,row,livemode),db=database();
 let code:string|null=null,qr:string|null=null;
 if(info.state==='ready'){
  if(typeof d.pix?.code!=='string'||!d.pix.code.startsWith('000201')||d.pix.code.length>4096)throw Error('Invalid Atlas PIX');
  const pixCode:string=d.pix.code;code=pixCode;
  // Build from the verified copy-and-paste code; never embed provider HTML or remote images.
  qr='data:image/svg+xml;base64,'+btoa(await QRCode.toString(pixCode,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320}));
 }
 const update=lease===undefined
  ?db.prepare('UPDATE payment_orders SET state=?,transaction_id=?,pix_code=?,qr=? WHERE id=?').bind(info.state,d.id,code,qr,row.id)
  :db.prepare('UPDATE payment_orders SET state=?,transaction_id=?,pix_code=?,qr=? WHERE id=? AND checked_at=?').bind(info.state,d.id,code,qr,row.id,lease);
 const metadata=lease===undefined
  ?db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(metaKey(row.id),JSON.stringify(info))
  :db.prepare('INSERT INTO payment_settings (key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM payment_orders WHERE id=? AND checked_at=? AND state=? AND transaction_id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(metaKey(row.id),JSON.stringify(info),row.id,lease,info.state,d.id);
 // D1 batches are transactional: the payment and its expiry/environment snapshot
 // must become visible together, and an older refresh cannot overwrite a newer one.
 const changed=await db.batch([update,metadata]);
 if(!changed[0].meta?.changes)throw Error('Atlas refresh superseded');
 if(info.state==='paid'||info.state==='test_paid')void notifyPortalSale(row.id).catch(()=>{});
 return info;
}

export async function createAtlas(b:any,c:Credential,ip:string){
 const payload=atlasOrder(b,ip),db=database();
 const {ip:_ip,...customer}=payload.customer;
 const identity=JSON.stringify({amount:b.amount,customer,sellerName:b.sellerName||null});
 const hash=await digest(identity);
 const now=Date.now();let id=crypto.randomUUID();
 const claimed=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'creating',now,now,'atlas',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 let row:any={id,request_id:b.requestId,amount:b.amount},lease=now;
 if(!claimed.meta?.changes){
  row=await db.prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(b.requestId).first();
  if(row?.provider!=='atlas'||row.payload_hash!==hash||(row.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados. Recupere a cobrança original.',code:'ORDER_CHANGED'},409);
  id=row.id;
  if(row.pix_code||['paid','test_paid'].includes(row.state))return link(id);
  if(row.state==='rejected')return atlasRejectedPayment(id);
  if(['failed','expired','refunded','chargeback'].includes(row.state))return json({error:'Esta cobrança foi encerrada ou estornada. Confira o pedido no painel Atlas.',code:'ATLAS_CLOSED'},409);
  if(row.state==='creating'&&row.checked_at>now-75000)return json({error:'Pedido em processamento. Aguarde e recupere o mesmo pedido.',code:'PAYMENT_PROCESSING'},409);
  lease=Math.max(now,row.checked_at+1);
  const lock=await db.prepare('UPDATE payment_orders SET state=?,checked_at=? WHERE id=? AND state=? AND checked_at=?').bind('creating',lease,id,row.state,row.checked_at).run();
  if(!lock.meta?.changes)return json({error:'Pedido em processamento. Aguarde antes de tentar novamente.'},409);
 }
 let stage='snapshot',httpStatus=0,failure:AtlasFailure|undefined;
 try{
  let snapshot=await credentials(payloadKey(id));
  if(!snapshot){await saveCredentials(JSON.stringify({payload,livemode:live(c),credentialHash:await digest(c.token)}),'',payloadKey(id));snapshot=await credentials(payloadKey(id));}
  const original=JSON.parse(snapshot.token);
  if(original.livemode!==live(c))throw Error('Atlas environment changed');
  let d:any;
  // Recover before posting again. The encrypted original body keeps IP, origin and
  // optional fields identical even when the buyer returns from another device/domain.
  if(!claimed.meta?.changes){
   stage='recovery';
   const path=row.transaction_id?'/charges/'+encodeURIComponent(row.transaction_id):'/charges?external_id='+encodeURIComponent(b.requestId)+'&limit=100';
   const recovered=await fetch(ATLAS_ORIGIN+path,{headers:auth(c),redirect:'manual',signal:AbortSignal.timeout(20000)});
   httpStatus=recovered.status;if(!recovered.ok)throw Error('Atlas recovery unavailable');
   const result:any=await recovered.json();
   if(row.transaction_id)d=result;
   else{
    if(result?.object!=='list'||!Array.isArray(result.data)||typeof result.has_more!=='boolean'||result.has_more||result.data.length>1)throw Error('Ambiguous Atlas recovery');
    d=result.data[0];
   }
  }
  if(!d){
   // A replacement key may belong to another Atlas account, whose idempotency
   // namespace is different. Querying is safe; a second POST is not authorized.
   if(original.credentialHash!==await digest(c.token))throw Error('Atlas credential changed before recovery');
   stage='connection';
   const raw=JSON.stringify(original.payload);
   const r=await fetch(ATLAS_ORIGIN+'/charges',{method:'POST',headers:{...auth(c),'Content-Type':'application/json','Idempotency-Key':b.requestId,'Content-Length':String(new TextEncoder().encode(raw).length)},body:raw,redirect:'manual',signal:AbortSignal.timeout(20000)});
   httpStatus=r.status;stage='http';
   if(!r.ok){
    failure=await atlasFailure(r,original.payload,!!claimed.meta?.changes,[c.token,c.agent]);
    await saveAtlasFailure(id,failure);
    // Only a first, explicit denial can authorize trying another gateway.
    if(claimed.meta?.changes&&await recordCreationRejection(id,r))return json({error:'A Atlas recusou a autenticação ou a permissão de venda.'},502);
    if(failure.confirmedNoCharge){
      await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('rejected',id,'creating').run();
      return atlasFailureResponse(failure);
    }
    throw Error('Unconfirmed Atlas create');
   }
   stage='json';d=await r.json();
  }
  stage='charge';await saveCharge({...row,id},d,original.livemode,lease);
  if(!['pending','paid'].includes(d.status))return json({error:'A Atlas encerrou esta cobrança com status '+d.status+'. Confira no painel Atlas.',code:'ATLAS_CLOSED'},502);
  return link(id);
 }catch{
  if(!failure)await saveAtlasFailure(id,{at:Date.now(),httpStatus,stage,reason:'unknown',message:'Não foi possível confirmar o resultado da cobrança na Atlas. Recupere o mesmo pedido.',providerCode:null,reference:null,confirmedNoCharge:false,buyerFields:{name:!!payload.customer?.name,email:!!payload.customer?.email,document:!!payload.customer?.document}}).catch(()=>{});
   const failureStatus=httpStatus>0?httpStatus:503;
   if(failureStatus!==401&&failureStatus!==403)await recordGatewayFailure('atlas',failureStatus);
  await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=? AND checked_at=?').bind('unconfirmed',id,'creating',lease).run().catch(()=>{});
  return json({error:'Não foi possível confirmar o PIX na Atlas'+(httpStatus?' (HTTP '+httpStatus+')':'')+'. Use Recuperar o mesmo pedido antes de iniciar outra cobrança.',code:'ATLAS_UNCONFIRMED'},502);
 }
}

export async function refreshAtlasPayment(row:any,force=false,timeout=15000){
 const db=database();
 if(!row.transaction_id)throw Error('Atlas charge unavailable');
 if(!force&&row.checked_at>=Date.now()-10000)return;
 const lease=Math.max(Date.now(),row.checked_at+1);
 const claim=await db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at=?').bind(lease,row.id,row.checked_at).run();
 if(!claim.meta?.changes){if(force)throw Error('Atlas refresh in progress');return;}
 const c=await credentials('atlas'),snapshot=await credentials(payloadKey(row.id));
 if(!c||!snapshot)throw Error('Atlas unavailable');
 const original=JSON.parse(snapshot.token);
 const r=await fetch(ATLAS_ORIGIN+'/charges/'+encodeURIComponent(row.transaction_id),{headers:auth(c),redirect:'manual',signal:AbortSignal.timeout(timeout)});
 if(!r.ok)throw Error('Atlas status unavailable');
 await saveCharge(row,await r.json(),original.livemode,lease);
}

export async function readAtlasPayment(row:any){
 await refreshAtlasPayment(row);
 const db=database(),current=await db.prepare('SELECT * FROM payment_orders WHERE id=?').bind(row.id).first();
 const saved=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind(metaKey(row.id)).first();
 if(!current||!saved)throw Error('Atlas payment unavailable');
 const meta=JSON.parse(saved.value),paid=current.state==='paid',simulatedPaid=current.state==='test_paid';
 const blocked=current.state!=='ready'||!!meta.expiresAt&&Date.parse(meta.expiresAt)<=Date.now();
 return json({amount:current.amount,paid,simulatedPaid,testMode:!meta.livemode,code:blocked?null:current.pix_code,qrUrl:blocked?null:current.qr,provider:'atlas',canVerify:true,unavailable:!paid&&blocked,status:current.state,expiresAt:meta.expiresAt});
}
