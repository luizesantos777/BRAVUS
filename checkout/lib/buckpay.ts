import QRCode from 'qrcode/lib/browser';
import {buck,credentials,database,json,PAYMENT_ORIGIN} from './payments';
import {notifyPortalSale} from './sales-webhook';
import {recordGatewayFailure} from './operational-health';

type BuckPayment = {
 id:string;
 amount:number;
 state:string;
 checked_at:number;
 transaction_id?:string|null;
 attendant_id?:string|null;
};

export async function buckFailure(response:Response,operation:string,sensitive:string[]=[]){
 let body:any;try{body=await response.json();}catch{}
 const c=await credentials('buckpay');
 let detail=[body?.error?.code,body?.error?.message,body?.error?.detail,body?.message,body?.detail].filter(x=>typeof x==='string').join(' ').slice(0,1500);
 for(const value of [c?.token,c?.agent,...sensitive])if(value)detail=detail.split(value).join('[oculto]');
 detail=detail.replace(/Bearer\s+\S+/gi,'[credencial]').replace(/https?:\/\/\S+/gi,'[endereço]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[e-mail]').replace(/(?:\d[\s.()/+-]*){8,}/g,'[documento]').replace(/[<>\x00-\x1f]/g,' ').slice(0,350);
 if(response.status!==401&&response.status!==403)await recordGatewayFailure('buckpay',response.status);
 const reason=response.status===401||response.status===403?'Confira o token e o User-Agent com a BuckPay.':response.status===429?'A BuckPay limitou as tentativas. Aguarde antes de consultar novamente.':'Confira a resposta da BuckPay.';
 return json({error:'BuckPay: HTTP '+response.status+'. '+(detail?detail+' ':reason+' ')+'Confira o painel antes de iniciar outra cobrança.',code:'BUCKPAY_HTTP_'+response.status},502);
}

function validBuckIdentity(data:any,row:{id:string;amount:number;transaction_id?:string|null}){
 return data?.total_amount===row.amount&&data.payment_method==='pix'&&
  typeof data.id==='string'&&data.id.length>0&&data.id.length<=200&&
  (data.external_id==null||data.external_id===row.id)&&
  (!row.transaction_id||data.id===row.transaction_id);
}

export async function refreshBuckPayment(row:BuckPayment){
 const now=Date.now();
 if(row.state==='paid'||row.checked_at>=now-30000)return;
 const db=database();
 const claim=await db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=? AND checked_at=?').bind(now,row.id,row.checked_at).run();
 if(!claim.meta?.changes)return;
 try{
  const response=await buck('/v1/transactions/external_id/'+encodeURIComponent(row.id));
  if(!response.ok)return;
  const {data}=await response.json() as any;
  if(data?.status!=='paid'||data.total_amount!==row.amount)return;
  // Individual checkouts require the exact authenticated PIX transaction for automatic approval.
  if(row.attendant_id&&!validBuckIdentity(data,row))return;
  const confirmed=await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND checked_at=?').bind('paid',row.id,now).run();
  if(confirmed.meta?.changes){row.state='paid';void notifyPortalSale(row.id).catch(()=>{});}
 }catch{}
}

export async function recoverBuck(row:{id:string;amount:number;transaction_id?:string|null},sellerName?:string){
 try{
  const r=await buck('/v1/transactions/external_id/'+encodeURIComponent(row.id));
  if(r.status===404)return json({error:'A consulta da BuckPay ainda não encontrou esta cobrança (HTTP 404). Confira no painel antes de iniciar outro pedido.',code:'BUCKPAY_NOT_FOUND'},409);
  if(!r.ok)return buckFailure(r,'lookup',sellerName?[sellerName]:[]);
  const result=await r.json() as any,d=result?.data;
  if(!validBuckIdentity(d,row))throw Error('Invalid identity');
  const db=database();
  if(d.status==='paid'){
   await db.prepare('UPDATE payment_orders SET state=?,transaction_id=? WHERE id=?').bind('paid',d.id,row.id).run();
   void notifyPortalSale(row.id).catch(()=>{});
   return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});
  }
  if(d.status!=='pending')return json({error:'A BuckPay encontrou a cobrança, mas ela não está aguardando pagamento. Confira o status no painel antes de iniciar outro pedido.',code:'BUCKPAY_NOT_PENDING'},409);
  if(typeof d.pix?.code!=='string'||!d.pix.code.startsWith('000201')||d.pix.code.length>4096)return json({error:'A BuckPay encontrou a cobrança pendente, mas a consulta não retornou o código PIX. Abra essa cobrança no painel BuckPay para recuperar o código.',code:'BUCKPAY_NO_PIX'},409);
  const svg=await QRCode.toString(d.pix.code,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320});
  await db.prepare('UPDATE payment_orders SET state=?,pix_code=?,qr=?,transaction_id=? WHERE id=?').bind('ready',d.pix.code,'data:image/svg+xml;base64,'+btoa(svg),d.id,row.id).run();
  return json({url:PAYMENT_ORIGIN+'/pagar/'+row.id});
 }catch{
  return json({error:'Não foi possível consultar e validar a cobrança anterior na BuckPay. Nenhuma nova cobrança foi enviada. Confira o painel e tente recuperar o mesmo pedido.',code:'BUCKPAY_RECOVERY_FAILED'},502);
 }
}
