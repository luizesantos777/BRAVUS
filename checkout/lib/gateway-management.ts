import {database} from './payments';
import {fallbackPolicy,gatewaySelection,isGateway} from './gateways';
import type {Gateway,FallbackPolicy} from './gateways';
import {ensureGatewayExclusionGuard,gatewayEnabled,lifecycleKey} from './gateway-status';

export async function excludeGateway(provider:Gateway,replacement?:Gateway,pauseCheckout=false){
 const db=database(),selection=await gatewaySelection();
 const oldPolicy=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('gateway_fallback_policy').first();
 const policy:FallbackPolicy=oldPolicy?JSON.parse(oldPolicy.value):await fallbackPolicy();
 policy.ticketRouting??={enabled:false,rules:[]};
 const old=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind(lifecycleKey(provider)).first();
 if(old&&JSON.parse(old.value).excluded)return;
 const suspend=selection.provider===provider&&(selection.suspended===true||pauseCheckout&&!replacement);
 const next=selection.provider===provider?(suspend?provider:replacement):selection.provider;
 if(selection.provider===provider&&!suspend&&(!next||next===provider||!await gatewayEnabled(next)))throw Error('Escolha outra gateway cadastrada para receber novos pagamentos antes de excluir a atual.');
 if(!next)throw Error('Selecione uma gateway substituta.');
 const nextLifecycle=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind(lifecycleKey(next)).first();
 if(selection.provider===provider&&!suspend&&nextLifecycle&&JSON.parse(nextLifecycle.value).excluded)throw Error('A gateway substituta foi excluída. Atualize o painel.');
 const order=policy.order.filter(id=>id!==provider);
 if(policy.enabled&&!suspend&&!order.includes(next))order.unshift(next);
 const rules=policy.ticketRouting.rules.filter(rule=>rule.gateway!==provider);
 const updated={...policy,enabled:!suspend&&policy.enabled&&order.length>=2,order,ticketRouting:{enabled:!suspend&&policy.ticketRouting.enabled&&rules.length>0,rules}};
 const record=JSON.stringify({excluded:true,at:Date.now(),revision:crypto.randomUUID()});
 await ensureGatewayExclusionGuard();
 // Every mutation depends on the same compared settings. D1 executes this batch
 // atomically, so a stale deletion cannot overwrite a newer routing decision.
 const claim=db.prepare(`INSERT INTO payment_settings (key,value) SELECT ?,? WHERE
 (SELECT value FROM payment_settings WHERE key='active_gateway') IS ? AND
 (SELECT value FROM payment_settings WHERE key='gateway_fallback_policy') IS ? AND
 (SELECT value FROM payment_settings WHERE key=?) IS ? AND
 (SELECT value FROM payment_settings WHERE key=?) IS ?
 ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(lifecycleKey(provider),record,selection.value,oldPolicy?.value??null,lifecycleKey(provider),old?.value??null,lifecycleKey(next),nextLifecycle?.value??null);
 const guard='(SELECT value FROM payment_settings WHERE key=?)=?';
 const commands=[claim,db.prepare('INSERT INTO payment_settings (key,value) SELECT ?,? WHERE '+guard+' ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('gateway_fallback_policy',JSON.stringify(updated),lifecycleKey(provider),record)];
 if(selection.provider===provider){const revision=crypto.randomUUID();commands.push(db.prepare('INSERT INTO payment_settings (key,value) SELECT ?,? WHERE '+guard+' ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('active_gateway',JSON.stringify({provider:next,revision,manualRevision:revision,...(suspend?{suspended:true}:{})}),lifecycleKey(provider),record));}
 commands.push(db.prepare('DELETE FROM payment_settings WHERE key=? AND '+guard).bind('gateway_health:'+provider,lifecycleKey(provider),record));
 const result=await db.batch(commands);if(!result[0].meta?.changes)throw Error('A configuração mudou durante a exclusão. Atualize o painel e tente novamente.');
}

export async function restoreGateway(provider:Gateway){
 if(!isGateway(provider))throw Error('Gateway inválida.');
 await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(lifecycleKey(provider),JSON.stringify({excluded:false,at:Date.now(),revision:crypto.randomUUID()})).run();
}
