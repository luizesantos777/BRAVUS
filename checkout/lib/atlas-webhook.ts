import {credentials,database,json} from './payments';
import {refreshAtlasPayment} from './atlas';
import {recordWebhookFailure} from './operational-health';

/** Web Crypto verifies HMAC without comparing secret-dependent strings in JavaScript. */
export async function verifyAtlasSignature(raw:string,header:string|null,secret:string,now=Date.now()){
 if(!header||header.length>256)return false;
 const match=/^t=(\d{10}),v1=([a-fA-F0-9]{64})$/.exec(header);
 if(!match||Math.abs(now/1000-Number(match[1]))>300)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const signature=Uint8Array.from(match[2].match(/../g)!,x=>parseInt(x,16));
 return crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(match[1]+'.'+raw));
}

async function rawBody(req:Request){
 if(Number(req.headers.get('content-length')||0)>262144)throw Error('Body too large');
 const reader=req.body?.getReader();if(!reader)return '';
 const parts:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('Body too large');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

export async function atlasWebhook(req:Request){
 try{
  const c=await credentials('atlas');if(!c?.agent)return json({error:'Webhook Atlas não configurado.'},503);
  let raw:string;try{raw=await rawBody(req);}catch{return json({error:'Corpo inválido.'},413);}
  if(!await verifyAtlasSignature(raw,req.headers.get('x-atlas-signature'),c.agent))return json({error:'Assinatura inválida ou vencida.'},401);
  let event:any;try{event=JSON.parse(raw);}catch{return json({error:'Evento inválido.'},400);}
  if(typeof event?.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(event.id)||event.id!==req.headers.get('x-atlas-event-id')||typeof event.type!=='string')return json({error:'Identificação do evento inválida.'},400);
  if(event.type==='webhook.test')return json({received:true,test:true});
  if(!['transaction.pending','transaction.paid','transaction.failed','transaction.expired','transaction.refunded','transaction.chargeback'].includes(event.type))return json({received:true,ignored:true});
  const db=database(),key='atlas_event:'+event.id;
  if(await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind(key).first())return json({received:true,duplicate:true});
  const data=event.data;
  if(!data||typeof data.id!=='string'||typeof data.external_id!=='string'||typeof data.livemode!=='boolean'||event.livemode!==data.livemode)return json({error:'Cobrança do evento inválida.'},400);
  const row=await db.prepare('SELECT * FROM payment_orders WHERE request_id=? AND provider=?').bind(data.external_id,'atlas').first();
  // Events from other checkouts on the same Atlas account belong to those systems.
  if(!row)return json({received:true,ignored:true});
  if(!row.transaction_id)return json({error:'Cobrança em processamento. Tente novamente.'},503);
  if(data.id!==row.transaction_id)return json({error:'Cobrança divergente.'},400);
  // Out-of-order, replayed or misleading events never set state directly. Verify
  // the authoritative charge, including amount, environment and external_id.
   try { await refreshAtlasPayment(row,true,3500); }
   catch { await recordWebhookFailure('atlas',503); throw Error('WEBHOOK_REFRESH_FAILED'); }
  await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind(key,JSON.stringify({chargeId:row.id,at:Date.now()})).run();
  return json({received:true});
 }catch{return json({error:'Não foi possível confirmar o evento. Tente novamente.'},503);}
}
