/* eslint-disable @typescript-eslint/no-explicit-any */
import {recordCreationRejection} from './gateway-failures';
import QRCode from 'qrcode/lib/browser';
import {credentials, database, json, PAYMENT_ORIGIN, saveCredentials} from './payments';
import {INVALID_CHECKOUT_AMOUNT,isCheckoutAmount,POSEIDON_PIX_MAX_CENTS} from './checkout-amount';
import {notifyPortalSale} from './sales-webhook';
export const POSEIDON_ORIGIN='https://app.poseidonpay.site/api/v1';
export class InputError extends Error {}
const invalid=()=>{throw new InputError('Confira o valor, os dados do comprador.');};
function field(value:unknown,min:number,max:number){if(typeof value!=='string')return invalid();const s=value.trim();if(s.length<min||s.length>max||/[\x00-\x1f<>]/.test(s))return invalid();return s;}
function digits(value:unknown){if(typeof value!=='string'||!/^[\d\s().+/-]+$/.test(value))return invalid();return value.replace(/\D/g,'');}
function documentValid(d:string){if(!/^(\d{11}|\d{14})$/.test(d)||/^(\d)\1+$/.test(d))return false;const check=(base:string,weights:number[])=>{const n=base.split('').reduce((s,c,i)=>s+Number(c)*weights[i],0)%11;return n<2?0:11-n;};if(d.length===11){return check(d.slice(0,9),[10,9,8,7,6,5,4,3,2])===+d[9]&&check(d.slice(0,10),[11,10,9,8,7,6,5,4,3,2])===+d[10];}return check(d.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2])===+d[12]&&check(d.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2])===+d[13];}
export function physicalOrder(b:any){
 if(!isCheckoutAmount(b.amount))throw new InputError(INVALID_CHECKOUT_AMOUNT);
 if(b.amount>POSEIDON_PIX_MAX_CENTS)throw new InputError('O PIX da Poseidon deve ser de at\u00e9 R$ 10.000,00.');
 const c=b.customer||{};
 const name=field(c.name,3,150),email=field(c.email,5,254),document=digits(c.cpf),phone=digits(c.phone);
 if(!name.includes(' ')||!/^\S+@\S+\.\S+$/.test(email)||!documentValid(document)||!/^\d{10,11}$/.test(phone))return invalid();
 return {identifier:b.requestId,amount:b.amount/100,client:{name,email,document,phone},products:[{id:'bravus-camisas-personalizadas',name:'Pedido de camisas personalizadas Bravus Brasil',quantity:1,price:b.amount/100,physical:true}],callbackUrl:PAYMENT_ORIGIN+'/api/webhooks/poseidon',isStrictWebhookToken:true};
}
export async function poseidonKey(){return credentials('poseidon');}
export class PoseidonSetupError extends Error {
 constructor(public code:string,message:string){super(message);this.name='PoseidonSetupError';}
}
export async function activatePoseidon(publicKey:string,secretKey:string){
 let response:Response;
 try{response=await fetch(POSEIDON_ORIGIN+'/gateway/producer/credentials',{headers:{accept:'application/json','x-public-key':publicKey,'x-secret-key':secretKey},redirect:'manual',signal:AbortSignal.timeout(15000)});}
 catch{throw new PoseidonSetupError('CONNECTION_FAILED','Não foi possível conectar à Poseidon. Tente novamente em alguns instantes.');}
 // Workers support manual redirects; never forward credentials to another destination.
 if(response.status>=300&&response.status<400)throw new PoseidonSetupError('UNEXPECTED_REDIRECT','A Poseidon redirecionou a validação para outro endereço. As chaves não foram encaminhadas.');
 if(response.status===401)return false;
 if(response.status===403)throw new PoseidonSetupError('ACCESS_DENIED','A Poseidon recusou o acesso do servidor. Confira as permissões da credencial e eventuais restrições de acesso no painel Poseidon.');
 if(response.status===429)throw new PoseidonSetupError('RATE_LIMITED','A Poseidon limitou as tentativas. Aguarde alguns minutos antes de tentar novamente.');
 if(!response.ok)throw new PoseidonSetupError('PROVIDER_UNAVAILABLE','A Poseidon está indisponível para validar as credenciais. Tente novamente mais tarde.');
 let result:any;
 try{result=await response.json();}catch{throw new PoseidonSetupError('INVALID_RESPONSE','A Poseidon respondeu em um formato inesperado. Não foi possível validar as credenciais.');}
 if(typeof result?.name!=='string'||!Array.isArray(result.permissions))throw new PoseidonSetupError('INVALID_RESPONSE','A Poseidon não retornou os dados esperados da credencial.');
 if(result.grantAllPermissions!==true&&!result.permissions.includes('PRODUCER_TRANSACTIONS'))throw new PoseidonSetupError('MISSING_PERMISSION','A credencial precisa da permissão de criar e consultar transações.');
 if(result.expiresAt!==null&&(!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now()))return false;
 try{await saveCredentials(secretKey,publicKey,'poseidon');}catch{throw new PoseidonSetupError('STORAGE_FAILED','As credenciais foram validadas, mas o armazenamento seguro falhou. A integração anterior continua selecionada.');}
 return true;
}

type PoseidonCredentials={token:string;agent:string};

function poseidonHeaders(c:PoseidonCredentials){return {'Content-Type':'application/json',accept:'application/json','x-public-key':c.agent,'x-secret-key':c.token};}

function poseidonRecord(result:any){
 if(!result||typeof result!=='object'||result.success===false||result.error||result.errorCode)return null;
 const data=result.data;
 return data&&typeof data==='object'&&!Array.isArray(data)?data:result;
}

function transactionId(result:any){
 const values=[result?.transactionId,result?.transaction_id,result?.transaction?.id,result?.id];
 return values.find(value=>typeof value==='string'&&value.trim().length>0&&value.length<=200)?.trim()||null;
}

function transactionReference(result:any){
 const values=[result?.identifier,result?.clientIdentifier,result?.externalRef,result?.external_ref,result?.reference,result?.requestId,result?.request_id,result?.transaction?.identifier,result?.transaction?.clientIdentifier,result?.transaction?.externalRef];
 return values.find(value=>typeof value==='string'&&value.trim().length>0)?.trim()||null;
}

function pixCode(result:any){
 const values=[result?.pix?.code,result?.pix?.qrCode,result?.pix?.qrcode,result?.pix?.copyPaste,result?.pix?.copy_paste,result?.pixInformation?.qrCode,result?.pix_information?.qr_code,result?.pixCode,result?.pix_code,result?.qrCode,result?.qrcode,result?.code];
 return values.find(value=>typeof value==='string'&&value.startsWith('000201')&&value.length<=4096)||null;
}

function status(result:any){
 const value=result?.status??result?.transactionStatus??result?.transaction_status??result?.state??result?.paymentStatus??result?.payment_status??result?.transaction?.status;
 return typeof value==='string'?value.trim().toLowerCase().replace(/[ -]+/g,'_'):'';
}

function amount(result:any){
 const value=result?.amount??result?.totalAmount??result?.total_amount??result?.transaction?.amount;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim()))return Number(value);
 return null;
}

function validTransaction(result:any,row:{amount:number;request_id:string;transaction_id?:string|null}){
 const id=transactionId(result);if(!id)return null;
 if(row.transaction_id&&id!==row.transaction_id)throw Error('POSEIDON_TRANSACTION_MISMATCH');
 const reference=transactionReference(result);if(reference&&reference!==row.request_id)throw Error('POSEIDON_REFERENCE_MISMATCH');
 const value=amount(result);
 if(value!==null&&value!==row.amount&&Math.abs(value*100-row.amount)>0.001)throw Error('POSEIDON_AMOUNT_MISMATCH');
 return id;
}

function transactionCandidates(value:any,depth=0):any[]{
 if(depth>4||value===null||value===undefined)return [];
 if(Array.isArray(value))return value.flatMap(item=>transactionCandidates(item,depth+1));
 if(typeof value!=='object')return [];
 const nested=['data','transactions','results','items','records'].flatMap(key=>transactionCandidates(value[key],depth+1));
 return transactionId(value)||transactionReference(value)||value.pix||value.status||value.state?[value,...nested]:nested;
}

async function poseidonTransaction(row:any,c:PoseidonCredentials){
 const queries=[
  row.transaction_id?`?id=${encodeURIComponent(row.transaction_id)}`:'',
  row.request_id?`?clientIdentifier=${encodeURIComponent(row.request_id)}`:'',
 ].filter(Boolean);
 for(const query of queries){
  let response:Response;
  try{response=await fetch(POSEIDON_ORIGIN+'/gateway/transactions'+query,{method:'GET',headers:poseidonHeaders(c),redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{continue;}
  if(!response.ok){if(response.status===401||response.status===403)return null;continue;}
  let body:any;try{body=await response.json();}catch{continue;}
  const candidates=transactionCandidates(body);
  const found=candidates.find(candidate=>{
   const id=transactionId(candidate),reference=transactionReference(candidate);
   return Boolean((row.transaction_id&&id===row.transaction_id)||(reference&&reference===row.request_id));
  });
  if(found)return poseidonRecord(found)||found;
 }
 return null;
}

const paidStatuses=new Set(['paid','completed','approved','success','succeeded','confirmed']);
const rejectedStatuses=new Set(['failed','refused','rejected','cancelled','canceled','expired','refunded','chargeback','chargedback']);
const terminalStatuses=new Set(['failed','refused','rejected','cancelled','canceled','expired','refunded','chargeback','chargedback']);

/**
 * Webhooks only wake this function up. The authenticated transaction lookup
 * remains authoritative, so a forged callback can never mark a sale paid.
 */
export async function syncPoseidon(row:any){
 const c=await poseidonKey();if(!c?.token||!c?.agent)return false;
 const result=await poseidonTransaction(row,c);if(!result)return false;
 const id=validTransaction(result,row);if(!id)return false;
 const state=status(result),db=database();
 if(paidStatuses.has(state)){
  const confirmed=await db.prepare('UPDATE payment_orders SET state=?,transaction_id=? WHERE id=? AND state<>?').bind('paid',id,row.id,'paid').run();
  if(confirmed.meta?.changes){row.state='paid';row.transaction_id=id;void notifyPortalSale(row.id).catch(()=>{});}
  else row.state='paid';
  return true;
 }
 const code=pixCode(result);
 if(rejectedStatuses.has(state)){
  await db.prepare('UPDATE payment_orders SET state=?,transaction_id=? WHERE id=?').bind(state,id,row.id).run();
  row.state=state;row.transaction_id=id;return true;
 }
 if(code){
  const qr=await QRCode.toString(code,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
  await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind('ready',code,'data:image/svg+xml;base64,'+btoa(qr),id,row.id).run();
  row.state='ready';row.pix_code=code;row.qr='data:image/svg+xml;base64,'+btoa(qr);row.transaction_id=id;
 }else{
  await db.prepare('UPDATE payment_orders SET transaction_id=? WHERE id=?').bind(id,row.id).run();
  row.transaction_id=id;
 }
 return true;
}

export async function readPoseidonPayment(row:any){
 if(row.state!=='paid'&&!terminalStatuses.has(row.state)&&row.checked_at<Date.now()-10000){
  const now=Date.now();
  const claim=await database().prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at=?').bind(now,row.id,row.checked_at).run();
  if(claim.meta?.changes)try{await syncPoseidon(row);}catch{}
 }
 const hidden=row.state==='paid'||terminalStatuses.has(row.state);
 return json({amount:row.amount,paid:row.state==='paid',code:hidden?null:row.pix_code,qrUrl:hidden?null:row.qr,provider:'poseidon',canVerify:true});
}

export async function createPoseidon(b:any,c:{token:string,agent:string}){
 const payload=physicalOrder(b);
 // Preserve the existing seller label for legacy requests.
 if(b.sellerName&&b.customerMode!=='manual')payload.client.name=b.sellerName;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)+(b.sellerName?'|seller:'+JSON.stringify(b.sellerName):''))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const db=database(),id=crypto.randomUUID();
 const claim=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'creating',Date.now(),'poseidon',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 if(!claim.meta?.changes){const row=await db.prepare('SELECT id,state,provider,payload_hash,attendant_id FROM payment_orders WHERE request_id=?').bind(b.requestId).first();if(row?.provider!=='poseidon'||row?.payload_hash!==hash||(row?.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados. Não gere outra cobrança sem conferir a anterior.'},409);if(['ready','paid'].includes(row.state))return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});return json({error:'Este pedido já foi enviado. Confira no painel Poseidon antes de iniciar outra cobrança; o resultado ainda não pôde ser confirmado.'},409);}
 try{
 const response=await fetch(POSEIDON_ORIGIN+'/gateway/pix/receive',{method:'POST',headers:poseidonHeaders(c),body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!response.ok){await recordCreationRejection(id,response);throw Error('Provider unavailable');}
 const d=poseidonRecord(await response.json()) as any;
 const transaction=validTransaction(d,{amount:b.amount,request_id:b.requestId});
 const code=pixCode(d);
 if(!transaction||!code||rejectedStatuses.has(status(d)))throw Error('Invalid response');
 const qr=await QRCode.toString(code,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
 await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind('ready',code,'data:image/svg+xml;base64,'+btoa(qr),transaction,id).run();
 if(typeof d.webhookToken==='string'&&d.webhookToken.length>=8&&d.webhookToken.length<=512){try{await saveCredentials(d.webhookToken,'webhook','poseidon_webhook_'+id);}catch{}}
 return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
 }catch{try{await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();}catch{}return json({error:'A Poseidon não confirmou o resultado da solicitação. Confira no painel Poseidon antes de iniciar outro pedido para evitar cobrança duplicada.'},502);}
}

