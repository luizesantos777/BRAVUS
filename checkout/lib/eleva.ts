import {recordCreationRejection} from './gateway-failures';
import {recordGatewayFailure} from './operational-health';
import {env} from 'cloudflare:workers';
import QRCode from 'qrcode/lib/browser';
import {credentials,database,json,PAYMENT_ORIGIN,saveCredentials} from './payments';
import {notifyPortalSale} from './sales-webhook';
import {documentValid,InputError} from './firebot';
import {INVALID_CHECKOUT_AMOUNT,isCheckoutAmount} from './checkout-amount';
export const ELEVA_ORIGIN='https://app.elevapayments.live/api/v1';
type Credential={token:string;agent:string};
const headers=(c:Credential)=>({Authorization:'Bearer '+c.token,'X-Client-ID':c.agent,Accept:'application/json','Content-Type':'application/json'});
export class ElevaSetupError extends Error {}
export async function activateEleva(token:string,clientId:string){
 const c={token:token.trim().replace(/^Bearer\s+/i,''),agent:clientId.trim()};
 async function probe(path:string){
  let r:Response;
  try{r=await fetch(ELEVA_ORIGIN+path,{headers:headers(c),redirect:'manual',signal:AbortSignal.timeout(30000)});}catch{throw new ElevaSetupError('Não foi possível conectar à Eleva. Tente novamente.');}
  if(r.status===401)return {unauthorized:true};
  if(r.status===403)throw new ElevaSetupError('A Eleva recusou o acesso (HTTP 403). Confira aprovação da conta, permissões da credencial e restrições de IP.');
  if(r.status===429)throw new ElevaSetupError('A Eleva limitou as tentativas (HTTP 429). Aguarde alguns minutos.');
  if(r.status>=300&&r.status<400)throw new ElevaSetupError('A Eleva redirecionou a validação (HTTP '+r.status+'). As credenciais não foram encaminhadas.');
  if(!r.ok){if(r.status===404&&path==='/balance')return {fallback:true};throw new ElevaSetupError('A consulta '+path.split('?')[0]+' da Eleva retornou HTTP '+r.status+'. Confira o painel Eleva e tente novamente.');}
  let d:any;try{d=await r.json();}catch{throw new ElevaSetupError('A Eleva retornou uma resposta não JSON. Tente novamente ou contate o suporte Eleva.');}
  if(d?.success===false)throw new ElevaSetupError('A Eleva respondeu success=false à consulta '+path.split('?')[0]+'. Confira as permissões da credencial.');
  if(!d||typeof d!=='object')return {fallback:true};
  const data=d.data??d;
  const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&/^\d+(\.\d+)?$/.test(v);
  const balance=path==='/balance'&&['balance','available_balance','available_for_withdrawal','available','total_balance'].some(k=>money(data[k]));
  const transactions=path.startsWith('/transactions')&&(Array.isArray(data)||Array.isArray(data.data)||Array.isArray(data.transactions)||Array.isArray(d.transactions));
  // A successful authenticated envelope or a recognizable balance/list confirms access.
  if(d.success===true&&d.data&&typeof d.data==='object'||balance||transactions)return {valid:true};
  return {fallback:true};
 }
 let result=await probe('/balance');if(result.unauthorized)return false;
 if(!result.valid){result=await probe('/transactions?per_page=1');if(result.unauthorized)return false;}
 if(!result.valid)throw new ElevaSetupError('A Eleva respondeu às consultas, mas não retornou saldo nem lista de transações reconhecíveis. Solicite ao suporte o exemplo JSON de GET /balance ou GET /transactions.');
 await saveCredentials(c.token,c.agent,'eleva');return true;
}
export function elevaOrder(b:any){
 if(!isCheckoutAmount(b.amount))throw new InputError(INVALID_CHECKOUT_AMOUNT);
 const defaults=env as unknown as Record<string,string>;
 const c={name:defaults.ELEVA_DEFAULT_PAYER_NAME,cpf:defaults.ELEVA_DEFAULT_PAYER_CPF,...(b.customer||{})};
 const name=typeof c.name==='string'?c.name.trim():'';
 const email=typeof c.email==='string'?c.email.trim():'';
 const cpf=typeof c.cpf==='string'?c.cpf.replace(/\D/g,''):'';
 if(name.length<3||name.length>150||/[\x00-\x1f<>]/.test(name))throw new InputError('Informe o nome do comprador para a Eleva.');
 if((email.length>254||!/^\S+@\S+\.\S+$/.test(email)||/[\x00-\x1f<>]/.test(email)))throw new InputError('Informe um e-mail válido do comprador para a Eleva.');
 if(!documentValid(cpf))throw new InputError('Informe um CPF ou CNPJ válido do comprador para a Eleva.');
 const phone=typeof c.phone==='string'?c.phone.replace(/\D/g,''):'';
 if(phone&&!/^(55)?\d{10,11}$/.test(phone))throw new InputError('Confira o telefone com DDD do comprador.');
 return {amount:b.amount/100,payer_name:name,...(email?{payer_email:email}:{}),...(cpf?{payer_cpf:cpf}:{}),...(phone?{payer_phone:phone}:{}),description:'Pedido Bravus Brasil',reference:b.requestId};
}
export function elevaResult(d:any,row:{amount:number;transaction_id?:string}){
 const amount=typeof d?.amount==='string'&&/^\d+(\.\d{1,2})?$/.test(d.amount)?Number(d.amount):d?.amount;
 if(!d||typeof d.transaction_uuid!=='string'||!/^[a-zA-Z0-9-]{8,200}$/.test(d.transaction_uuid)||typeof amount!=='number'||!Number.isFinite(amount)||Math.abs(amount*100-row.amount)>0.001||row.transaction_id&&d.transaction_uuid!==row.transaction_id)throw Error('Invalid payment identity or amount');
 const states:Record<string,string>={pending:'ready',waiting_payment:'ready',processing:'ready',completed:'paid',failed:'failed',cancelled:'cancelled',refunded:'refunded',chargeback:'chargeback',mediation:'mediation'};
 if(!states[d.status])throw Error('Unknown payment status');
 const expiresAt=typeof d.expires_at==='string'&&Number.isFinite(Date.parse(d.expires_at))?d.expires_at:null;
 return {state:states[d.status],expiresAt};
}
export async function createEleva(b:any,c:Credential){
 const payload=elevaOrder(b),db=database();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)+'|'+JSON.stringify(b.sellerName||null))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 let id=crypto.randomUUID();const now=Date.now();
 const claimed=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'creating',now,now,'eleva',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 if(!claimed.meta?.changes){
  const row=await db.prepare('SELECT id,state,provider,payload_hash,checked_at,pix_code,attendant_id FROM payment_orders WHERE request_id=?').bind(b.requestId).first();
  if(row?.provider!=='eleva'||row.payload_hash!==hash||(row.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados. Confira a cobrança anterior.'},409);
  id=row.id;if(row.pix_code)return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
  if(row.state==='rejected')return json({error:'A Eleva recusou os dados deste pedido. Confira os dados e inicie outro pedido.'},409);
  if(row.state==='creating'&&row.checked_at>now-75000)return json({error:'Este pedido ainda está sendo processado. Recupere o mesmo pedido quando a tentativa terminar.'},409);
  const lock=await db.prepare('UPDATE payment_orders SET checked_at=?,state=? WHERE id=? AND checked_at=? AND state=?').bind(now,'creating',id,row.checked_at,row.state).run();
  if(!lock.meta?.changes)return json({error:'Pedido em processamento. Aguarde antes de tentar novamente.'},409);
 }
 let stage='connection',httpStatus=0,retried=false;
 try{
  const send=()=>fetch(ELEVA_ORIGIN+'/payments/pix',{method:'POST',headers:{...headers(c),'Idempotency-Key':b.requestId},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(30000)});
  let r=await send();
  // One bounded retry, with the same payload and idempotency key, for a provider HTTP timeout.
  if(r.status===408){retried=true;await r.body?.cancel();r=await send();}
  httpStatus=r.status;stage='http';
  if(!r.ok){
   if(claimed.meta?.changes&&!retried)await recordCreationRejection(id,r);
   if(claimed.meta?.changes&&!retried&&[400,401,403,422].includes(r.status)){
    await db.prepare('UPDATE payment_orders SET state=? WHERE id=?').bind('rejected',id).run();
    return json({error:r.status===422?'A Eleva recusou os dados do comprador (HTTP 422). Confira nome, e-mail e CPF/CNPJ.':'A Eleva recusou a cobrança. Confira as credenciais e permissões no painel Eleva.'},502);
   }
   throw Error('Unconfirmed');
  }
  stage='json';const result=await r.json() as any;stage='envelope';if(result.success!==true)throw Error('Invalid response');const d=result.data;
  stage='identity';const status=elevaResult(d,{amount:b.amount});
  stage='pix';if(typeof d.pix_code!=='string'||!d.pix_code.startsWith('000201')||d.pix_code.length>4096)throw Error('Invalid PIX');
  stage='qr';const svg=await QRCode.toString(d.pix_code,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
  stage='storage';await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('eleva_expiry_'+id,JSON.stringify(status.expiresAt)).run();
  await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind(status.state,d.pix_code,'data:image/svg+xml;base64,'+btoa(svg),d.transaction_uuid,id).run();
  return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
 }catch{
    const failureStatus=httpStatus>0?httpStatus:503;
    if(failureStatus!==401&&failureStatus!==403)await recordGatewayFailure('eleva',failureStatus);
  try{await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();}catch{}
  const reasons:Record<string,string>={connection:'Não foi possível concluir a conexão com a Eleva.',http:httpStatus===408?'A Eleva esgotou o tempo de resposta (HTTP 408), mesmo após uma tentativa automática.':'A Eleva retornou HTTP '+httpStatus+'.',json:'A Eleva retornou uma resposta fora do formato JSON.',envelope:'A Eleva não confirmou sucesso na resposta.',identity:'A resposta da Eleva não confirmou a identificação, o valor ou o status do pedido.',pix:'A Eleva não retornou um código PIX válido.',qr:'Não foi possível montar o QR Code retornado pela Eleva.',storage:'Não foi possível salvar o PIX retornado pela Eleva.'};
  return json({error:reasons[stage]+' Use Recuperar o mesmo pedido. Confira o painel Eleva antes de iniciar outra cobrança.',code:'ELEVA_'+stage.toUpperCase()},502);
 }
}
export async function readElevaPayment(row:any,timeout=30000){
 const db=database();let status=row.state;
 const expiry=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('eleva_expiry_'+row.id).first();let expiresAt=expiry?JSON.parse(expiry.value):null;
 if(row.checked_at<Date.now()-10000){
  const claim=await db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at=?').bind(Date.now(),row.id,row.checked_at).run();
  if(claim.meta?.changes){
   const c=await credentials('eleva');if(!c)throw Error('Not configured');
   const r=await fetch(ELEVA_ORIGIN+'/payments/'+encodeURIComponent(row.transaction_id),{headers:headers(c),redirect:'manual',signal:AbortSignal.timeout(timeout)});
   if(!r.ok)throw Error('Verification unavailable');const result=await r.json() as any;if(result.success!==true)throw Error('Invalid response');
   const updated=elevaResult(result.data,row);status=updated.state;expiresAt=updated.expiresAt||expiresAt;
   await db.prepare('UPDATE payment_orders SET state=? WHERE id=?').bind(status,row.id).run();if(status==='paid'||status==='test_paid')void notifyPortalSale(row.id).catch(()=>{});
   if(expiresAt)await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('eleva_expiry_'+row.id,JSON.stringify(expiresAt)).run();
  }
 }
 const paid=status==='paid',expired=!!expiresAt&&Date.parse(expiresAt)<=Date.now();
 const blocked=!paid&&(status!=='ready'||expired);
 return json({amount:row.amount,paid,code:paid||blocked?null:row.pix_code,qrUrl:paid||blocked?null:row.qr,provider:'eleva',canVerify:true,unavailable:blocked,status,expiresAt});
}
