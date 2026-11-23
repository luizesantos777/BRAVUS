import {recordCreationRejection} from './gateway-failures';
import QRCode from 'qrcode/lib/browser';
import {credentials, database, json, PAYMENT_ORIGIN, saveCredentials} from './payments';
import {INVALID_CHECKOUT_AMOUNT,isCheckoutAmount} from './checkout-amount';
import {paymentBuyerName} from './checkout-buyer-fields';
export const FIREBOT_ORIGIN='https://firebotbr.com/api/v1';
export class InputError extends Error {}
const invalid=(message:string):never=>{throw new InputError(message);};
function field(value:unknown,min:number,max:number,message:string){if(typeof value!=='string')return invalid(message);const s=value.trim().replace(/\s+/g,' ');if(s.length<min||s.length>max||/[\x00-\x1f<>]/.test(s))return invalid(message);return s;}
function digits(value:unknown,message:string){if(typeof value!=='string'||!/^[\d\s().+/-]+$/.test(value))return invalid(message);return value.replace(/\D/g,'');}
export function documentValid(d:string){if(!/^(\d{11}|\d{14})$/.test(d)||/^(\d)\1+$/.test(d))return false;const check=(base:string,weights:number[])=>{const n=base.split('').reduce((s,c,i)=>s+Number(c)*weights[i],0)%11;return n<2?0:11-n;};if(d.length===11){return check(d.slice(0,9),[10,9,8,7,6,5,4,3,2])===+d[9]&&check(d.slice(0,10),[11,10,9,8,7,6,5,4,3,2])===+d[10];}return check(d.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2])===+d[12]&&check(d.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2])===+d[13];}
export function digitalOrder(b:any,requireAddress=true){
 if(!isCheckoutAmount(b.amount))return invalid(INVALID_CHECKOUT_AMOUNT);
 const c=b.customer||{};
 const name=field(c.name,3,150,'Informe o nome completo do comprador, com nome e sobrenome.');
 if(!name.includes(' '))return invalid('Informe o nome completo do comprador, com nome e sobrenome.');
 const email=field(c.email,5,254,'Confira o e-mail do comprador, por exemplo nome@dominio.com.');
 if(!/^\S+@\S+\.\S+$/.test(email))return invalid('Confira o e-mail do comprador, por exemplo nome@dominio.com.');
 const document=digits(c.cpf,'Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos.');
 if(!documentValid(document))return invalid('O CPF ou CNPJ não passou na validação. Confira todos os dígitos do documento.');
 let phone=digits(c.phone,'Informe o telefone com DDD. Pode incluir +55.');
 if(/^55\d{10,11}$/.test(phone))phone=phone.slice(2);
 if(!/^\d{10,11}$/.test(phone))return invalid('Informe o telefone com DDD: 10 ou 11 dígitos, sem contar o +55.');
 const address=requireAddress?field(c.address,15,500,'Informe o endereço completo: rua, número, bairro, cidade, UF e CEP (entre 15 e 500 caracteres).'):'';
 return {productType:'DIGITAL',storeUrl:PAYMENT_ORIGIN+'/checkout',amount:b.amount/100,description:'Produto digital Bravus Brasil — entrega pelo WhatsApp',customer:{name,email,cpf:document,phone,address},qrStyle:'plain'};
}
export async function firebotKey(){return credentials('firebot');}
export class FirebotSetupError extends Error {
 constructor(public code:string,message:string){super(message);this.name='FirebotSetupError';}
}
export async function activateFirebot(secretKey:string){
 let response:Response;
 let accountValidation=false;
 try{
 const options={headers:{accept:'application/json','x-api-key':secretKey},redirect:'manual' as const,signal:AbortSignal.timeout(15000)};
 response=await fetch(FIREBOT_ORIGIN+'/auth',options);
 // The documented /auth route currently returns 404. The documented, read-only
 // /account endpoint also authenticates x-api-key; never use a charge to test a key.
 if(response.status===404){
 await response.body?.cancel();
 accountValidation=true;
 response=await fetch(FIREBOT_ORIGIN+'/account',options);
 }
 }
 catch{throw new FirebotSetupError('CONNECTION_FAILED','Não foi possível conectar à Firebot. Tente novamente em alguns instantes.');}
 // Workers support manual redirects; never forward credentials to another destination.
 if(response.status>=300&&response.status<400)throw new FirebotSetupError('UNEXPECTED_REDIRECT','A Firebot redirecionou a validação para outro endereço. As chaves não foram encaminhadas.');
 if(response.status===401)return false;
 if(response.status===403)throw new FirebotSetupError('ACCESS_DENIED','A Firebot recusou o acesso do servidor. Confira as permissões da credencial e eventuais restrições de acesso no painel Firebot.');
 if(response.status===429)throw new FirebotSetupError('RATE_LIMITED','A Firebot limitou as tentativas. Aguarde alguns minutos antes de tentar novamente.');
 if(response.status===404)throw new FirebotSetupError('ENDPOINT_UNAVAILABLE','As rotas de validação documentadas pela Firebot não foram encontradas. Contate o suporte Firebot.');
 if(!response.ok)throw new FirebotSetupError('PROVIDER_UNAVAILABLE','A Firebot está indisponível para validar as credenciais. Tente novamente mais tarde.');
 let result:any;
 try{result=await response.json();}catch{throw new FirebotSetupError('INVALID_RESPONSE','A Firebot respondeu em um formato inesperado. Não foi possível validar as credenciais.');}
 if(result?.success!==true)return false;
 if(accountValidation&&(!result.account||typeof result.account!=='object'||Array.isArray(result.account)))throw new FirebotSetupError('INVALID_RESPONSE','A Firebot não confirmou os dados da conta. Não foi possível validar as credenciais.');
 try{await saveCredentials(secretKey,'','firebot');}catch{throw new FirebotSetupError('STORAGE_FAILED','As credenciais foram validadas, mas o armazenamento seguro falhou. A integração anterior continua selecionada.');}
 return true;
}
export function firebotOrder(b:any){
 // A PIX checkout may carry contact details for reserve gateways. Firebot's
 // full customer format is used only with a complete address.
 const useFullCustomer=b.customerMode!=='manual'||typeof b.customer?.address==='string'&&b.customer.address.trim();
 if(useFullCustomer&&b.customer&&Object.keys(b.customer).length)return digitalOrder(b);
 if(!isCheckoutAmount(b.amount))return invalid(INVALID_CHECKOUT_AMOUNT);
 return {productType:'DIGITAL',storeUrl:PAYMENT_ORIGIN+'/checkout',amount:b.amount/100,description:'Produto digital Bravus Brasil — entrega pelo WhatsApp',qrStyle:'plain'};
}
export async function createFirebot(b:any,c:{token:string,agent:string}){
 const payload=firebotOrder(b);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)+(b.sellerName?'|seller:'+JSON.stringify(b.sellerName):''))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 // Keep the existing fingerprint format so retries recover older PIX links.
 // sellerName is already included in that fingerprint above.
 if(b.sellerName)payload.description='Vendedor: '+b.sellerName+' | '+payload.description;
 const buyerName=paymentBuyerName(b);
 const providerPayload=buyerName?{...payload,customer:{...('customer' in payload?payload.customer:{}),name:buyerName}}:payload;
 const db=database(),id=crypto.randomUUID();
 const claim=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'creating',Date.now(),'firebot',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 if(!claim.meta?.changes){const row=await db.prepare('SELECT id,state,provider,payload_hash,attendant_id FROM payment_orders WHERE request_id=?').bind(b.requestId).first();if(row?.provider!=='firebot'||row?.payload_hash!==hash||(row?.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados. Não gere outra cobrança sem conferir a anterior.'},409);if(row.state==='ready')return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});return json({error:'Este pedido já foi enviado. Confira no painel Firebot antes de iniciar outra cobrança; o resultado ainda não pôde ser confirmado.'},409);}
 try{
 const response=await fetch(FIREBOT_ORIGIN+'/pix/create',{method:'POST',headers:{'Content-Type':'application/json',accept:'application/json','x-api-key':c.token},body:JSON.stringify(providerPayload),redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!response.ok){await recordCreationRejection(id,response);throw Error('Provider unavailable');}
 const d=await response.json() as any;
 if(d.success!==true||typeof d.amount!=='number'||Math.round(d.amount*100)!==b.amount||typeof d.transactionId!=='string'||d.transactionId.length>200||typeof d.pixCopiaECola!=='string'||!d.pixCopiaECola.startsWith('000201')||d.pixCopiaECola.length>4096)throw Error('Invalid response');
 const qr=await QRCode.toString(d.pixCopiaECola,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
 await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind('ready',d.pixCopiaECola,'data:image/svg+xml;base64,'+btoa(qr),d.transactionId,id).run();
 return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
 }catch{try{await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();}catch{}return json({error:'A Firebot não confirmou o resultado da solicitação. Confira no painel Firebot antes de iniciar outro pedido para evitar cobrança duplicada.'},502);}
}
