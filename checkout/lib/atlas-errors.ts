import {credentials,database,json,saveCredentials} from './payments';
export type AtlasFailure={at:number;httpStatus:number;stage:string;reason:string;message:string;detail?:string;providerCode:string|null;reference:string|null;confirmedNoCharge:boolean;buyerFields:{name:boolean;email:boolean;document:boolean}};
const keyFor=(id:string)=>'atlas_failure:'+id;
const codes=new Set(['invalid_request','validation_error','authentication_required','forbidden','conflict','rate_limited','service_unavailable','not_found','not_implemented','length_required','payload_too_large']);
const messages:Record<string,string>={document:'A Atlas recusou o CPF/CNPJ do comprador. Confira o documento informado.',email:'A Atlas recusou o e-mail do comprador. Confira o endereço informado.',name:'A Atlas recusou o nome do comprador. Informe o nome completo.',checkout:'A Atlas recusou o endereço do checkout. Confira a configuração da integração no painel Atlas.',method:'A Atlas recusou a forma de pagamento. Esta integração usa apenas PIX.',amount:'A Atlas recusou o valor da cobrança. Confira os limites da sua conta.',account:'A Atlas recusou a cobrança por uma condição da conta. Confira as permissões e a situação da conta no painel Atlas.',unknown:'A Atlas recusou a cobrança. Consulte o motivo no painel Atlas.'};
function chargeEvidence(value:any,depth=0):boolean{
 if(depth>8)return true;
 if(!value||typeof value!=='object')return false;
 return Object.entries(value).some(([key,item])=>item!=null&&item!==''&&(/^(id|uuid|charge.*|transaction.*|payment.*id|external_?id|pix.*|qr.*)$/i.test(key)||/^(state|status)$/i.test(key)&&/^(paid|pending|processing|approved|completed|authorized|ready)$/i.test(String(item))||chargeEvidence(item,depth+1)));
}
function redactDetail(text:string,payload:any,secrets:string[]){
 let safe=text.slice(0,4096).replace(/[\x00-\x1f]/g,' ').replace(/<[^>]*>/g,'');
 const literal=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const value of [...secrets,payload.customer?.email,payload.customer?.document,payload.customer?.phone,...String(payload.customer?.name||'').split(/\s+/)].filter((x):x is string=>typeof x==='string'&&x.length>=3))safe=safe.replace(new RegExp(literal(value),'gi'),'[oculto]');
 return safe.replace(/Bearer\s+[^\s,;]+/gi,'[credencial oculta]').replace(/(?:atlas_(?:sk|pk)_|whsec_)[A-Za-z0-9._=-]+/gi,'[credencial oculta]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[e-mail oculto]').replace(/\b\d{3}\.?\d{3}\.?\d{3}[-.]?\d{2}\b/g,'[documento oculto]').replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}[-.]?\d{2}\b/g,'[documento oculto]').replace(/(?:\+\d{1,3}\s*)?\(?\d{2}\)?[\s.-]?\d{4,5}[-.\s]?\d{4}\b/g,'[telefone oculto]').slice(0,1200);
}
export async function atlasFailure(response:Response,payload:any,firstAttempt:boolean,secrets:string[]=[]):Promise<AtlasFailure>{
 let body:any=null;
 try{const raw=await response.clone().text();if(raw.length<=16384)body=JSON.parse(raw);}catch{}
 const detail=typeof body?.detail==='string'?body.detail:Array.isArray(body?.detail)?body.detail.slice(0,20).map((item:any)=>Array.isArray(item?.loc)?item.loc.join('.'):typeof item?.msg==='string'?item.msg:'').join(' '):typeof body?.error?.message==='string'?body.error.message:'';
 const text=detail.slice(0,4096).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 let reason='unknown';
 if(/checkout_url|landing_page|dominio|endereco.*checkout|url.*checkout/.test(text))reason='checkout';
 else if(/cpf|cnpj|document/.test(text))reason='document';
 else if(/e-?mail/.test(text))reason='email';
 else if(/customer[.\s]+name|nome.*comprador|nome completo/.test(text))reason='name';
 else if(/method|forma de pagamento|cartao|boleto/.test(text))reason='method';
 else if(/amount|valor.*(minim|maxim|limite)|ticket/.test(text))reason='amount';
 else if(/conta|permiss|kyc|verific|bloquead|account/.test(text))reason='account';
 const ref=response.headers.get('x-request-id')||body?.error?.request_id;
 const reference=typeof ref==='string'&&/^req_[A-Za-z0-9_-]{1,120}$/.test(ref)&&!/(atlas_(sk|pk)_|whsec_|bearer)/i.test(ref)?ref:null;
 const providerCode=codes.has(body?.error?.code)?body.error.code:null;
 const confirmedNoCharge=firstAttempt&&[400,422].includes(response.status)&&body?.error?.status===response.status&&['invalid_request','validation_error'].includes(providerCode||'')&&body?.data==null&&body?.success!==true&&!chargeEvidence(body);
 return {at:Date.now(),httpStatus:response.status,stage:'http',reason,message:messages[reason],detail:redactDetail(detail,payload,secrets),providerCode,reference,confirmedNoCharge,buyerFields:{name:!!payload.customer?.name,email:!!payload.customer?.email,document:!!payload.customer?.document}};
}
export async function saveAtlasFailure(id:string,failure:AtlasFailure){await saveCredentials(JSON.stringify(failure),'',keyFor(id));}
export async function readAtlasFailure(id:string):Promise<AtlasFailure|null>{const c=await credentials(keyFor(id));return c?JSON.parse(c.token):null;}
export function atlasFailureResponse(failure:AtlasFailure){
 return json({error:failure.message+' (HTTP '+failure.httpStatus+').'+(failure.reference?' Referência Atlas: '+failure.reference:''),code:'ATLAS_REJECTED',provider:'atlas',reason:failure.reason,...(failure.reference?{reference:failure.reference}:{}),...(failure.confirmedNoCharge?{retryMode:'new_order'}:{})},502);
}
export async function atlasRejectedPayment(id:string){
 const failure=await readAtlasFailure(id);
 return failure?.confirmedNoCharge?atlasFailureResponse(failure):json({error:'Esta cobrança foi recusada ou encerrada. Confira o pedido no painel Atlas antes de iniciar outro.',code:'ATLAS_CLOSED',provider:'atlas'},409);
}
export async function atlasDiagnostics(){
 const rows=await database().prepare("SELECT p.id,p.amount,p.created_at FROM payment_orders p JOIN payment_settings s ON s.key='atlas_failure:'||p.id WHERE p.provider='atlas' ORDER BY p.created_at DESC,p.id DESC LIMIT 20").all();
 const errors=[];for(const row of rows.results){const failure=await readAtlasFailure(row.id);if(failure)errors.push({id:row.id,amountCents:row.amount,...failure});}return errors;
}
