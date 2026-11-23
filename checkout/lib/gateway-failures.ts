import {database} from './payments';
import {isGateway} from './gateways';
import {recordGatewayFailure} from './operational-health';

/** Only an authentication rejection is conclusive enough to try another provider. */
export async function recordCreationRejection(id:string,response:Response){
 const status=response.status;
 if(status!==401&&status!==403)return false;
 // A refusal with charge identifiers or an unreadable body is not proof that no
 // transaction exists. Leave that request on its original provider for recovery.
 let body:any;try{const raw=await response.clone().text();if(raw.length>16384)return false;body=JSON.parse(raw);}catch{return false;}
 if(!body||typeof body!=='object'||Array.isArray(body)||body.success===true)return false;
 if(body.data!=null)return false;
 if(!body.error&&!body.errors&&!body.message&&body.success!==false)return false;
 function hasCharge(value:any,depth=0):boolean{
  if(depth>8)return true;
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>item!=null&&item!==''&&(/^(id|uuid|charge.*|transaction.*|payment.*id|external_?id|identifier|pix.*|qr.*)$/i.test(key)||/^(state|status)$/i.test(key)&&/^(paid|pending|processing|approved|completed|authorized|ready)$/i.test(String(item))||hasCharge(item,depth+1)));
 }
 if(hasCharge(body))return false;
 const db=database();
 const payment=await db.prepare('SELECT provider FROM payment_orders WHERE id=?').bind(id).first() as {provider?:string}|null;
 const provider=payment?.provider==='beehive_card'?'beehive':payment?.provider;
 if(isGateway(provider))await recordGatewayFailure(provider,status);
 const result=await db.prepare('UPDATE payment_orders SET state=? WHERE id=? AND state=? AND transaction_id IS NULL AND pix_code IS NULL').bind('rejected',id,'creating').run();
 if(!result.meta?.changes)return false;
 await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind('gateway_rejection:'+id,JSON.stringify({status,at:Date.now()})).run();
 return true;
}
export async function isConfirmedRejection(row:any){
 if(!row||row.transaction_id||row.pix_code||row.state!=='rejected')return false;
 const saved=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('gateway_rejection:'+row.id).first();
 if(!saved)return false;
 const value=JSON.parse(saved.value);return value.status===401||value.status===403;
}
