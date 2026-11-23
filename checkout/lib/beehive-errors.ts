import {database,json} from './payments';
import {recordGatewayFailure} from './operational-health';
export function safeBeeDetail(body:any,secrets:string[]=[]){
 const parts:string[]=[];
 const collect=(value:any,depth=0)=>{if(depth>3)return;if(typeof value==='string'){parts.push(value);return;}if(Array.isArray(value)){value.slice(0,6).forEach(v=>collect(v,depth+1));return;}if(value&&typeof value==='object')for(const key of ['message','detail','description','code','error','errors','error_messages'])if(value[key]!==undefined)collect(value[key],depth+1);};
 collect(body);let detail=parts.join(' ').slice(0,3000);
 for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))detail=detail.split(secret).join('[oculto]');
 return detail.replace(/(?:Basic|Bearer)\s+\S+/gi,'[credencial]').replace(/(?:sk|pk)_(?:live|test)_\S+/gi,'[credencial]').replace(/https?:\/\/\S+/gi,'[endereço]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[e-mail]').replace(/(?:\d[\s.()/+-]*){8,}/g,'[documento]').replace(/[<>\x00-\x1f]/g,' ').slice(0,450);
}
export async function saveBeeFailure(id:string,response:Response,secrets:string[]){
 let body:any;try{body=await response.json();}catch{}
 const failure={status:response.status,detail:safeBeeDetail(body,secrets)};
 if(response.status!==401&&response.status!==403)await recordGatewayFailure('beehive',response.status);
 try{await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('beehive_error_'+id,JSON.stringify(failure)).run();}catch{}
 return failure;
}
export async function beeFailureMessage(id:string,fallback?:{status:number;detail:string}){
 let failure=fallback;
 if(!failure)try{const saved=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('beehive_error_'+id).first();if(saved)failure=JSON.parse(saved.value);}catch{}
 return json({error:failure?'Beehive: HTTP '+failure.status+'. '+(failure.detail||'A plataforma não informou o motivo detalhado.')+' Use Recuperar o mesmo pedido. Confira no painel antes de criar outra cobrança.':'A consulta não conseguiu confirmar esta cobrança. Nenhuma nova cobrança foi enviada. Confira no painel Beehive antes de iniciar outro pedido.',code:failure?'BEEHIVE_HTTP_'+failure.status:'BEEHIVE_UNCONFIRMED'},502);
}
