import {recordCreationRejection} from './gateway-failures';
import {recordGatewayFailure} from './operational-health';
import {env} from 'cloudflare:workers';
import QRCode from 'qrcode/lib/browser';
import {credentials, database, json, PAYMENT_ORIGIN, saveCredentials} from './payments';
import {notifyPortalSale} from './sales-webhook';
import {digitalOrder} from './firebot';
export const GESTAO_ORIGIN='https://api.gestaopayments.com';
type Keys={token:string,agent:string};
function authorization(c:Keys){return 'Basic '+btoa(c.agent+':'+c.token);}
export function gestaoOrder(b:any){
 const defaults=env as unknown as Record<string,string>;
 const customer={name:defaults.GESTAO_DEFAULT_PAYER_NAME,cpf:defaults.GESTAO_DEFAULT_PAYER_CPF,email:defaults.GESTAO_DEFAULT_PAYER_EMAIL,...(b.customer||{})};
 const order=digitalOrder({...b,customer},false),c=order.customer;
 return {payment_method:'pix',amount:b.amount,customer:{name:c.name,email:c.email,document:{type:c.cpf.length===11?'cpf':'cnpj',number:c.cpf},phone:'55'+c.phone},items:[{title:order.description,unit_price:b.amount,quantity:1,tangible:false,external_ref:b.requestId}],pix:{expires_in_days:1}};
}
export async function gestaoKey(){return credentials('gestao');}
export class GestaoSetupError extends Error {constructor(public code:string,message:string){super(message);}}
// The API uses both direct records and the common {success, data} envelope.
// Reject explicit failures before considering a nested record.
function responseRecord(result:any){
 if(!result||typeof result!=='object'||Array.isArray(result)||result.success===false||result.error||Array.isArray(result.error_messages)&&result.error_messages.length)return null;
 const record=Object.prototype.hasOwnProperty.call(result,'data')?result.data:result;
 return record&&typeof record==='object'&&!Array.isArray(record)?record:null;
}
export async function activateGestao(publicKey:string,secretKey:string){
 let response:Response;
 try{response=await fetch(GESTAO_ORIGIN+'/v1/company',{headers:{accept:'application/json',authorization:authorization({agent:publicKey,token:secretKey})},redirect:'manual',signal:AbortSignal.timeout(15000)});}
 catch{throw new GestaoSetupError('CONNECTION_FAILED','Não foi possível conectar à Gestão Pay. Tente novamente.');}
 if(response.status===401)return false;
 if(!response.ok||response.status>=300)throw new GestaoSetupError('VALIDATION_FAILED','A Gestão Pay não permitiu validar as credenciais. Confira as permissões da API e tente novamente.');
 let d:any;try{d=await response.json();}catch{throw new GestaoSetupError('INVALID_RESPONSE','Resposta inesperada da Gestão Pay.');}
 const company=responseRecord(d);
 if(typeof company?.id!=='string'||!company.id.trim()||![company.cnpj,company.fantasy_name].some(v=>typeof v==='string'&&v.trim().length>0))throw new GestaoSetupError('INVALID_RESPONSE','A Gestão Pay não confirmou os dados da empresa.');
 await saveCredentials(secretKey,publicKey,'gestao');return true;
}
export async function gestaoStatus(row:any){
 const c=await gestaoKey();if(!c||!row.transaction_id)return false;
 const r=await fetch(GESTAO_ORIGIN+'/v1/payment-transaction/info/'+encodeURIComponent(row.transaction_id),{headers:{accept:'application/json',authorization:authorization(c)},redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!r.ok)return false;
 const d=responseRecord(await r.json());
 return d?.id===row.transaction_id&&d.amount===row.amount&&d.payment_method==='pix'&&d.status==='PAID';
}

export async function refreshGestaoPayment(row:{id:string;amount:number;state:string;checked_at:number;transaction_id:string|null}){
 const now=Date.now();
 if(row.state==='paid'||!row.transaction_id||row.checked_at>=now-30000)return;
 const db=database();
 const claim=await db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at=?').bind(now,row.id,row.checked_at).run();
 if(!claim.meta?.changes)return;
 try{
  if(!await gestaoStatus(row))return;
  const confirmed=await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND checked_at=?').bind('paid',row.id,now).run();
  if(confirmed.meta?.changes){row.state='paid';void notifyPortalSale(row.id).catch(()=>{});}
 }catch{}
}

function validTransaction(d:any,amount:number){return d?.amount===amount&&d.payment_method==='pix'&&typeof d.id==='string'&&d.id.length>0&&d.id.length<=200;}
async function storePix(id:string,d:any){
 if(typeof d.pix?.qr_code!=='string'||!d.pix.qr_code.startsWith('000201')||d.pix.qr_code.length>4096)throw Error('PIX_MISSING');
 const qr=await QRCode.toString(d.pix.qr_code,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
 await database().prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind('ready',d.pix.qr_code,'data:image/svg+xml;base64,'+btoa(qr),d.id,id).run();
 return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
}
async function recoverGestao(row:any,c:Keys){
 if(!row.transaction_id)return json({error:'A Gestão Pay não retornou o identificador desta cobrança. Confira o pedido manualmente no painel Gestão Pay antes de iniciar outro.',code:'GESTAO_NO_TRANSACTION_ID'},409);
 try{
  const response=await fetch(GESTAO_ORIGIN+'/v1/payment-transaction/info/'+encodeURIComponent(row.transaction_id),{headers:{accept:'application/json',authorization:authorization(c)},redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('LOOKUP_HTTP_'+response.status);
  const d=responseRecord(await response.json());
  if(!validTransaction(d,row.amount)||d.id!==row.transaction_id)throw Error('INVALID_TRANSACTION');
  if(d.status==='PAID'){
   await database().prepare('UPDATE payment_orders SET state=? WHERE id=?').bind('paid',row.id).run();void notifyPortalSale(row.id).catch(()=>{});
   return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});
  }
  if(d.status!=='PENDING')return json({error:'A cobrança não está pendente na Gestão Pay. Confira o status no painel.',code:'GESTAO_NOT_PENDING'},409);
  return await storePix(row.id,d);
 }catch{return json({error:'Não foi possível recuperar o PIX da Gestão Pay. Nenhuma nova cobrança foi enviada. Confira no painel ou use Recuperar o mesmo pedido.',code:'GESTAO_RECOVERY_FAILED'},502);}
}
function providerDetail(result:any,payload:any,c:Keys){
 const errors=Array.isArray(result?.error_messages)?result.error_messages:[];
 let detail=[...errors.map((e:any)=>typeof e==='string'?e:e?.message),result?.message,typeof result?.error==='string'?result.error:result?.error?.message].filter(v=>typeof v==='string').join(' ').slice(0,2000);
 for(const secret of [c.token,c.agent,payload.customer.name,payload.customer.email,payload.customer.document.number,payload.customer.phone])if(secret)detail=detail.split(secret).join('[oculto]');
 return detail.replace(/https?:\/\/\S+/gi,'[endereço]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[e-mail]').replace(/(?:\d[\s.()/+-]*){8,}/g,'[documento]').replace(/[<>\x00-\x1f]/g,' ').slice(0,300);
}
export async function createGestao(b:any,c:{token:string,agent:string}){
 const payload=gestaoOrder(b);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)+(b.sellerName?'|seller:'+JSON.stringify(b.sellerName):''))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 // Preserve the existing seller label for legacy requests.
 if(b.sellerName&&b.customer?.name&&b.customerMode!=='manual')payload.customer.name=b.sellerName;
 const db=database(),id=crypto.randomUUID();
 const claim=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'creating',Date.now(),'gestao',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 if(!claim.meta?.changes){const row=await db.prepare('SELECT id,state,provider,payload_hash,amount,transaction_id,attendant_id FROM payment_orders WHERE request_id=?').bind(b.requestId).first();if(row?.provider!=='gestao'||row?.payload_hash!==hash||(row?.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados. Não gere outra cobrança sem conferir a anterior.'},409);if(row.state==='ready'||row.state==='paid')return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});return recoverGestao(row,c);}
 let stage='request',httpStatus:number|undefined;
 try{
 const response=await fetch(GESTAO_ORIGIN+'/v1/payment-transaction/create',{method:'POST',headers:{'Content-Type':'application/json',accept:'application/json',authorization:authorization(c)},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(20000)});
 httpStatus=response.status;stage='response';if(!response.ok)await recordCreationRejection(id,response);
 let result:any;try{result=await response.json();}catch{throw Error('INVALID_JSON');}
 const d=responseRecord(result);
 if(!response.ok||!d){
  const detail=providerDetail(result,payload,c);
   if(httpStatus!==401&&httpStatus!==403)await recordGatewayFailure('gestao',httpStatus??503);
  await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();
  const reason=httpStatus===401||httpStatus===403?'Confira as credenciais e permissões da API no painel.':httpStatus===429?'Aguarde antes de consultar novamente.':detail||'A resposta não confirmou a criação do PIX.';
  return json({error:'Gestão Pay: HTTP '+httpStatus+'. '+reason+' Confira no painel antes de iniciar outra cobrança.',code:'GESTAO_HTTP_'+httpStatus},502);
 }
 stage='validation';if(!validTransaction(d,b.amount))throw Error('INVALID_TRANSACTION');
 // Preserve the provider ID before QR rendering so retries can GET the same charge.
 stage='store-transaction';
 await db.prepare('UPDATE payment_orders SET transaction_id=? WHERE id=?').bind(d.id,id).run();
 stage='store-pix';return await storePix(id,d);
 }catch(error){
  if(httpStatus!==401&&httpStatus!==403)await recordGatewayFailure('gestao',httpStatus??503);
 try{await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();}catch{}
 return json({error:'Não foi possível concluir o PIX da Gestão Pay'+(httpStatus?' (HTTP '+httpStatus+')':'')+'. Use Recuperar o mesmo pedido. Confira no painel Gestão Pay antes de iniciar outra cobrança.',code:'GESTAO_UNCONFIRMED'},502);
 }
}
