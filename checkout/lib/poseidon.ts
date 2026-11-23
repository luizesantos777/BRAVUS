import {recordCreationRejection} from './gateway-failures';
import QRCode from 'qrcode/lib/browser';
import {credentials, database, json, PAYMENT_ORIGIN, saveCredentials} from './payments';
import {INVALID_CHECKOUT_AMOUNT,isCheckoutAmount,POSEIDON_PIX_MAX_CENTS} from './checkout-amount';
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
 return {identifier:b.requestId,amount:b.amount/100,client:{name,email,document,phone},products:[{id:'bravus-camisas-personalizadas',name:'Pedido de camisas personalizadas Bravus Brasil',quantity:1,price:b.amount/100,physical:true}]};
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
export async function createPoseidon(b:any,c:{token:string,agent:string}){
 const payload=physicalOrder(b);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)+(b.sellerName?'|seller:'+JSON.stringify(b.sellerName):''))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 // Preserve the existing seller label for legacy requests.
 if(b.sellerName&&b.customerMode!=='manual')payload.client.name=b.sellerName;
 const db=database(),id=crypto.randomUUID();
 const claim=await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,created_at,checked_at,provider,payload_hash,seller_name,origin,attendant_id) VALUES (?,?,?,?,?,0,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(id,b.requestId,b.amount,'creating',Date.now(),'poseidon',hash,b.sellerName||null,b.checkoutOrigin||null,b.attendantId??null).run();
 if(!claim.meta?.changes){const row=await db.prepare('SELECT id,state,provider,payload_hash,attendant_id FROM payment_orders WHERE request_id=?').bind(b.requestId).first();if(row?.provider!=='poseidon'||row?.payload_hash!==hash||(row?.attendant_id??null)!==(b.attendantId??null))return json({error:'Este pedido já foi iniciado com outros dados. Não gere outra cobrança sem conferir a anterior.'},409);if(row.state==='ready')return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});return json({error:'Este pedido já foi enviado. Confira no painel Poseidon antes de iniciar outra cobrança; o resultado ainda não pôde ser confirmado.'},409);}
 try{
 const response=await fetch(POSEIDON_ORIGIN+'/gateway/pix/receive',{method:'POST',headers:{'Content-Type':'application/json',accept:'application/json','x-public-key':c.agent,'x-secret-key':c.token},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!response.ok){await recordCreationRejection(id,response);throw Error('Provider unavailable');}
 const d=await response.json() as any;
 if(d.status!=='OK'||typeof d.transactionId!=='string'||d.transactionId.length>200||typeof d.pix?.code!=='string'||!d.pix.code.startsWith('000201')||d.pix.code.length>4096)throw Error('Invalid response');
 const qr=await QRCode.toString(d.pix.code,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
 await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind('ready',d.pix.code,'data:image/svg+xml;base64,'+btoa(qr),d.transactionId,id).run();
 return json({url:PAYMENT_ORIGIN+'/pagar/'+id});
 }catch{try{await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=?').bind('unconfirmed',id,'creating').run();}catch{}return json({error:'A Poseidon não confirmou o resultado da solicitação. Confira no painel Poseidon antes de iniciar outro pedido para evitar cobrança duplicada.'},502);}
}

