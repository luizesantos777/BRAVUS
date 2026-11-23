import {recordCreationRejection} from './gateway-failures';
import {recordGatewayFailure} from './operational-health';
import {saveBeeFailure,beeFailureMessage} from './beehive-errors';
import QRCode from 'qrcode/lib/browser';
import {credentials,database,json,PAYMENT_ORIGIN,saveCredentials} from './payments';
import {notifyPortalSale} from './sales-webhook';
import {documentValid,InputError} from './firebot';
import {biocamisasCustomer} from './biocamisas-customer';
import {checkoutBrandForOrigin} from './checkout-brand';
export const BEEHIVE_ORIGIN='https://api.conta.paybeehive.com.br/v1';
const record=(d:any)=>!d||typeof d!=='object'||d.success===false||d.error?null:(d.data??d);
export async function beeRequest(path:string,token:string,body?:unknown){return fetch(BEEHIVE_ORIGIN+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+btoa(token+':x'),Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});}
export async function activateBeehive(token:string,publicKey:string){
 const r=await beeRequest('/company',token);
 if(!r.ok)throw Error('Beehive: HTTP '+r.status+' ao validar a chave secreta. A configuração anterior foi preservada.');
 const d=record(await r.json());
 if(!Number.isSafeInteger(d?.id)||d.id<=0)throw Error('A Beehive não confirmou a empresa. A configuração anterior foi preservada.');
 await saveCredentials(token,publicKey,'beehive');
}
export function beeOrder(b:any,ip:string,requirePhone=false){
 const c=b.customer||{},name=typeof c.name==='string'?c.name.trim():'',email=typeof c.email==='string'?c.email.trim():'',cpf=typeof c.cpf==='string'?c.cpf.replace(/\D/g,''):'';
 let phone=typeof c.phone==='string'?c.phone.replace(/\D/g,''):'';
 if(/^55\d{10,11}$/.test(phone))phone=phone.slice(2);
 if((requirePhone||phone)&&!(/^[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(phone)))throw new InputError('Informe um telefone válido com DDD: 10 ou 11 dígitos. Pode incluir +55.');
 if(name.length<3||name.length>150||/[<>\x00-\x1f]/.test(name))throw new InputError('Informe o nome completo do comprador.');
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw new InputError('Informe um e-mail válido do comprador.');
 if(!documentValid(cpf))throw new InputError('Confira o CPF ou CNPJ do comprador.');
 if(!ip||ip.length>64||!/^[0-9a-f:.]+$/i.test(ip))throw new InputError('Não foi possível identificar a conexão. Atualize a página.');
 return {amount:b.amount,paymentMethod:'pix',customer:{name,email,...(phone?{phone}:{}),document:{type:cpf.length===11?'cpf':'cnpj',number:cpf}},items:[{title:'Pedido Bravus Brasil',unitPrice:b.amount,quantity:1,tangible:true}],pix:{expiresInSeconds:86400},externalRef:b.requestId,ip,metadata:{provider:'Bravus Brasil',user_email:email,order_id:b.requestId,checkout_url:PAYMENT_ORIGIN+'/checkout',shop_url:PAYMENT_ORIGIN},postbackUrl:PAYMENT_ORIGIN+'/api/webhooks/beehive'};
}
// Server-only customer configuration. Never expose these records in public APIs.
async function customerKey(name:string){
 const normalized=name.trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 return 'beehive_customer_'+hash;
}
export async function configureBeehiveCustomer(customer:any){
 const validated=beeOrder({customer},'127.0.0.1',true).customer;
 await saveCredentials(JSON.stringify({name:validated.name,email:validated.email,cpf:validated.document.number,phone:validated.phone}),'customer',await customerKey(validated.name));
}
export async function registeredBeehiveCustomer(name:string){
 const saved=await credentials(await customerKey(name));
 return saved?{...JSON.parse(saved.token),name}:null;
}
export class BeehiveBuyerDetailsRequired extends InputError {
 constructor(){super('Preencha os dados do comprador para gerar o PIX. Nenhuma cobrança foi enviada.');}
}
export async function backendCustomer(b:any,existing:any){
 const name=typeof b.customer?.name==='string'?b.customer.name.trim():'';
 if(name.length<3)throw new InputError('Informe o nome completo do cliente.');
 const snapshot=existing?await credentials('beehive_customer_order_'+existing.id):null;
 if(snapshot){const saved=JSON.parse(snapshot.token);if(await customerKey(saved.name)!==await customerKey(name))throw new InputError('Este pedido pertence a outro cliente.');return saved;}
 // Legacy recovery keeps its original fields and never sends another POST.
 if(existing)return b.customer;
 if(b[VERIFIED_FALLBACK_BUYER])return b[VERIFIED_FALLBACK_BUYER];
 if(b.customerMode==='manual'){
  const {email,cpf,phone}=b.customer;
  return {name,email,cpf,phone};
 }
 const saved=await registeredBeehiveCustomer(name);
 if(saved)return saved;
 const preset=biocamisasCustomer(checkoutBrandForOrigin(b.checkoutOrigin).id,name);
 if(preset)return preset;
 throw new BeehiveBuyerDetailsRequired();
}
// Symbols cannot be supplied through a JSON request. Only the fallback runner
// sets this after resolving the registered customer into an encrypted snapshot.
export const VERIFIED_FALLBACK_BUYER=Symbol('verified-fallback-buyer');
function validate(d:any,row:any){
 if(!Number.isSafeInteger(d?.id)||d.id<=0||d.amount!==row.amount||d.paymentMethod!=='pix'||(row.transaction_id&&String(d.id)!==row.transaction_id)||d.externalRef!==row.request_id)throw Error('INVALID_TRANSACTION');
}
async function storeResult(row:any,d:any){
 validate(d,row);const db=database();
 await db.prepare('UPDATE payment_orders SET transaction_id=? WHERE id=?').bind(String(d.id),row.id).run();
 if(d.status==='paid'){
  await db.prepare('UPDATE payment_orders SET state=? WHERE id=?').bind('paid',row.id).run();void notifyPortalSale(row.id).catch(()=>{});return;
 }
 if(!['waiting_payment','pending','created','processing'].includes(d.status))throw Error('NOT_PENDING');
 const code=d.pix?.qrcode??d.pix?.qrCode??d.qrCode;
 if(typeof code!=='string'||!code.startsWith('000201')||code.length>4096)throw Error('PIX_MISSING');
 const qr=await QRCode.toString(code,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
 await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind('ready',code,'data:image/svg+xml;base64,'+btoa(qr),String(d.id),row.id).run();
}
export async function syncBeehive(row:any){
 const c=await credentials('beehive');if(!c||!row.transaction_id)return false;
 const r=await beeRequest('/transactions/'+encodeURIComponent(row.transaction_id),c.token);if(!r.ok)return false;
 const d=record(await r.json());validate(d,row);
 if(d.status==='paid'){await database().prepare('UPDATE payment_orders SET state=? WHERE id=?').bind('paid',row.id).run();void notifyPortalSale(row.id).catch(()=>{});row.state='paid';}
 return true;
}
async function recoverBeehive(row:any,c:{token:string},email:string){
 try{
  if(!row.transaction_id){
   // Filter by customer, but match the exact order reference before any recovery.
   const response=await beeRequest('/transactions?paymentMethods=pix&email='+encodeURIComponent(email),c.token);
   if(!response.ok)return beeFailureMessage(row.id);
   const body=await response.json() as any;
   if(body?.success===false||body?.error)return beeFailureMessage(row.id);
   const rows=Array.isArray(body)?body:Array.isArray(body?.data)?body.data:[];
   const matches=rows.filter((d:any)=>d.externalRef===row.request_id&&d.amount===row.amount&&d.paymentMethod==='pix'&&Number.isSafeInteger(d.id)&&d.id>0);
   if(matches.length!==1)return beeFailureMessage(row.id);
   row.transaction_id=String(matches[0].id);
   await database().prepare('UPDATE payment_orders SET transaction_id=? WHERE id=?').bind(row.transaction_id,row.id).run();
  }
  const r=await beeRequest('/transactions/'+encodeURIComponent(row.transaction_id),c.token);
  if(!r.ok)return beeFailureMessage(row.id);
  const d=record(await r.json());validate(d,row);
  if(['refused','canceled','cancelled','expired','refunded','chargedback'].includes(d.status))return json({error:'A Beehive encontrou o pedido com status '+d.status+'. Confira no painel antes de iniciar outro pagamento.',code:'BEEHIVE_NOT_PENDING'},409);
  await storeResult(row,d);return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});
 }catch{return beeFailureMessage(row.id);}
}
export async function createBeehive(b:any,c:{token:string},ip:string){
 const existing=await database().prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(b.requestId).first();
 // Existing attempts must remain recoverable with their original payload.
 const customer=await backendCustomer(b,existing);
 const payload=beeOrder({...b,customer},ip,!existing);
 // IP can change during recovery; it is not part of the order identity.
 const {ip:ignored,...identity}=payload;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)+'|'+(b.sellerName||''))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const db=database(),id=crypto.randomUUID();
 const claim=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'creating',Date.now(),'beehive',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 if(!claim.meta?.changes){
  const row=await db.prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(b.requestId).first();
  if(row?.provider!=='beehive'||row.payload_hash!==hash||(row.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados.'},409);
  if(['ready','paid'].includes(row.state))return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});
  return recoverBeehive(row,c,payload.customer.email);
 }
 await saveCredentials(JSON.stringify(customer),'order','beehive_customer_order_'+id);
 let status:number|undefined,stage='request';
 try{
  const r=await beeRequest('/transactions',c.token,payload);status=r.status;
  if(!r.ok){await recordCreationRejection(id,r);const failure=await saveBeeFailure(id,r,[c.token,b.sellerName||'',payload.customer.name,payload.customer.email,payload.customer.document.number,payload.customer.phone||'',ip]);await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();return beeFailureMessage(id,failure);}
  stage='response';const d=record(await r.json());await storeResult({id,request_id:b.requestId,amount:b.amount},d);
  return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
 }catch{
   const failureStatus=status??503;
   if(failureStatus!==401&&failureStatus!==403)await recordGatewayFailure('beehive',failureStatus);
  try{await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();}catch{}
  return json({error:'A Beehive não confirmou o PIX'+(status?' (HTTP '+status+')':'')+'. Use Recuperar o mesmo pedido e confira no painel antes de iniciar outra cobrança.'},502);
 }
}
export async function readBeehive(row:any){
 if(row.state!=='paid'&&row.checked_at<Date.now()-30000){
  const claim=await database().prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at=?').bind(Date.now(),row.id,row.checked_at).run();
  if(claim.meta?.changes)try{await syncBeehive(row);}catch{}
 }
 return json({amount:row.amount,paid:row.state==='paid',code:row.state==='paid'?null:row.pix_code,qrUrl:row.state==='paid'?null:row.qr,provider:'beehive',canVerify:true});
}
