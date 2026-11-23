import {credentials,database} from './payments';
import {gatewayEnabled,gatewayExcluded,lifecycleKey} from './gateway-status';
import {MAX_CHECKOUT_CENTS} from './checkout-amount';
import {logOperationalEvent} from './operational-log';
export const gateways=['gestao','firebot','poseidon','buckpay','eleva','beehive','atlas'] as const;
export type Gateway=typeof gateways[number];
export const isGateway=(value:unknown):value is Gateway=>typeof value==='string'&&(gateways as readonly string[]).includes(value);
export type GatewaySelection={provider:Gateway;value:string|null;epoch:string;suspended?:boolean};
export type TicketRule={aboveCents:number;gateway:Gateway};
export type FallbackPolicy={enabled:boolean;autoSwitch:boolean;order:Gateway[];ticketRouting:{enabled:boolean;rules:TicketRule[]}};
export type GatewayHealth={failedUntil:number;at:number;reason:'rejected'|'unconfirmed';epoch:string};
const POLICY='gateway_fallback_policy';
export async function gatewaySelection():Promise<GatewaySelection>{
 const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('active_gateway').first();
 if(row){let provider=row.value,epoch=row.value,suspended=false;if(!isGateway(provider)){const record=JSON.parse(row.value);provider=record.provider;epoch=record.manualRevision??record.revision;suspended=record.suspended===true;}if(!isGateway(provider)||typeof epoch!=='string')throw Error('Invalid gateway');return {provider,value:row.value,epoch,...(suspended?{suspended:true}:{})};}
 // Preserve the gateway already in use until the owner makes a selection.
 for(const provider of gateways)if(await gatewayEnabled(provider))return {provider,value:null,epoch:'legacy'};
 return {provider:'buckpay',value:null,epoch:'legacy'};
}
export async function activeGateway():Promise<Gateway>{return (await gatewaySelection()).provider;}
export async function preserveGatewaySelection(){
 const current=await gatewaySelection();
 if(current.value!==null)return;
 const revision=crypto.randomUUID();
 // Pin the legacy default before saving credentials of a higher-priority
 // integration. Never replace a manual selection made by another request.
 await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind('active_gateway',JSON.stringify({provider:current.provider,revision,manualRevision:revision})).run();
}
export async function selectGateway(provider:Gateway){
 if(!isGateway(provider)||!await gatewayEnabled(provider))return false;
 // A revision distinguishes an explicit manual selection of the same provider.
 const revision=crypto.randomUUID();
 const saved=await database().prepare("INSERT INTO payment_settings (key,value) SELECT ?,? WHERE COALESCE(json_extract((SELECT value FROM payment_settings WHERE key=?),'$.excluded'),0)=0 ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('active_gateway',JSON.stringify({provider,revision,manualRevision:revision}),lifecycleKey(provider)).run();
 if(!saved.meta?.changes)return false;
 await database().prepare('DELETE FROM payment_settings WHERE key=?').bind('gateway_health:'+provider).run();return true;
}
export async function fallbackPolicy():Promise<FallbackPolicy>{
 const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind(POLICY).first();
 if(!row)return {enabled:false,autoSwitch:true,order:[...gateways],ticketRouting:{enabled:false,rules:[]}};
 const value=JSON.parse(row.value);
 if(typeof value.enabled!=='boolean'||typeof value.autoSwitch!=='boolean'||!Array.isArray(value.order)||value.order.length>gateways.length||value.order.some((id:unknown)=>!isGateway(id))||new Set(value.order).size!==value.order.length)throw Error('Invalid fallback policy');
 return {...value,ticketRouting:value.ticketRouting??{enabled:false,rules:[]}};
}
export async function saveFallbackPolicy(input:unknown):Promise<FallbackPolicy>{
 if(!input||typeof input!=='object')throw new Error('Informe a configuração do fallback.');
 const value=input as FallbackPolicy;
 if(typeof value.enabled!=='boolean'||typeof value.autoSwitch!=='boolean'||!Array.isArray(value.order)||value.order.length>gateways.length||value.order.some(id=>!isGateway(id))||new Set(value.order).size!==value.order.length)throw new Error('Escolha uma ordem válida, sem gateways repetidas.');
 for(const id of [...value.order,...(value.ticketRouting?.rules||[]).map((r:any)=>r?.gateway)].filter(isGateway))if(await gatewayExcluded(id))throw new Error('Uma gateway foi excluída. Atualize o painel antes de salvar as regras.');
 if(value.enabled){
  const selected=await activeGateway();
  if(!value.order.includes(selected)||value.order.length<2)throw new Error('Inclua a gateway ativa e pelo menos uma reserva configurada.');
  for(const id of value.order)if(!await gatewayEnabled(id))throw new Error('Cadastre as credenciais de todas as gateways escolhidas antes de ativar o fallback.');
 }
 const routing=value.ticketRouting;
 if(!routing||typeof routing.enabled!=='boolean'||!Array.isArray(routing.rules)||routing.rules.length>10||routing.rules.some(rule=>!rule||!Number.isSafeInteger(rule.aboveCents)||rule.aboveCents<0||rule.aboveCents>=MAX_CHECKOUT_CENTS||!isGateway(rule.gateway))||new Set(routing.rules.map(rule=>rule.aboveCents)).size!==routing.rules.length)throw new Error('Informe faixas de ticket válidas, sem valores repetidos.');
 if(routing.enabled){if(!routing.rules.length)throw new Error('Adicione pelo menos uma regra por valor.');for(const rule of routing.rules)if(!await gatewayEnabled(rule.gateway))throw new Error('Cadastre as credenciais das gateways usadas nas faixas de ticket.');}
 const policy={enabled:value.enabled,autoSwitch:value.autoSwitch,order:value.order,ticketRouting:{enabled:routing.enabled,rules:[...routing.rules].sort((a,b)=>a.aboveCents-b.aboveCents)}};
 const targets=JSON.stringify([...new Set([...policy.order,...policy.ticketRouting.rules.map(r=>r.gateway)])]);
 const saved=await database().prepare("INSERT INTO payment_settings (key,value) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM json_each(?) t JOIN payment_settings s ON s.key='gateway_lifecycle:'||t.value WHERE json_extract(s.value,'$.excluded')=1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(POLICY,JSON.stringify(policy),targets).run();
 if(!saved.meta?.changes)throw new Error('Uma gateway foi excluída durante a edição. Atualize o painel.');return policy;
}
export async function gatewayHealth(provider:Gateway):Promise<GatewayHealth|null>{
 const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('gateway_health:'+provider).first();return row?JSON.parse(row.value):null;
}
export async function markGatewayFailure(provider:Gateway,reason:GatewayHealth['reason'],epoch:string){
 const at=Date.now();
 logOperationalEvent('gateway_failure',{source:provider,status:reason==='rejected'?401:503});
 await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('gateway_health:'+provider,JSON.stringify({at,failedUntil:at+300000,reason,epoch})).run();
}
export async function switchGatewayAutomatically(selection:GatewaySelection,to:Gateway,reason:GatewayHealth['reason']){
 if(selection.provider===to||!await gatewayEnabled(to))return false;
 const value=JSON.stringify({provider:to,revision:crypto.randomUUID(),manualRevision:selection.epoch});
 const result=selection.value===null
  ?await database().prepare("INSERT INTO payment_settings (key,value) SELECT ?,? WHERE COALESCE(json_extract((SELECT value FROM payment_settings WHERE key=?),'$.excluded'),0)=0 ON CONFLICT(key) DO NOTHING").bind('active_gateway',value,lifecycleKey(to)).run()
  :await database().prepare("UPDATE payment_settings SET value=? WHERE key=? AND value=? AND COALESCE(json_extract((SELECT value FROM payment_settings WHERE key=?),'$.excluded'),0)=0").bind(value,'active_gateway',selection.value,lifecycleKey(to)).run();
 if(!result.meta?.changes)return false;
 await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('gateway_last_switch',JSON.stringify({from:selection.provider,to,reason,at:Date.now()})).run();return true;
}
export async function lastGatewaySwitch(){const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('gateway_last_switch').first();return row?JSON.parse(row.value):null;}
export async function gatewayForAmount(amount?:number,policy?:FallbackPolicy,selection?:GatewaySelection){
 const current=selection??await gatewaySelection(),rules=policy??await fallbackPolicy();
 if(current.suspended)return {provider:current.provider,primary:current.provider,selection:current,byTicket:false,available:false};
 const matched=amount!==undefined&&rules.ticketRouting.enabled?rules.ticketRouting.rules.filter(rule=>amount>rule.aboveCents).at(-1):undefined;
 const primary=matched?.gateway??current.provider;
 let provider=primary,available=await gatewayEnabled(primary);
 if(rules.enabled&&rules.autoSwitch){
  const health=await gatewayHealth(primary);
  if(!available||(health&&health.epoch===current.epoch&&health.failedUntil>Date.now())){
   available=false;
   for(const candidate of rules.order){const status=await gatewayHealth(candidate);if(await gatewayEnabled(candidate)&&(!status||status.epoch!==current.epoch||status.failedUntil<=Date.now())){provider=candidate;available=true;break;}}
  }
 }
 return {provider,primary,selection:current,byTicket:!!matched,available};
}
