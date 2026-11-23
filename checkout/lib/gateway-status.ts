import {credentials,database} from './payments';
import type {Gateway} from './gateways';
export const lifecycleKey=(provider:Gateway)=>'gateway_lifecycle:'+provider;
export async function gatewayLifecycle(provider:Gateway){const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind(lifecycleKey(provider)).first();return row?JSON.parse(row.value):{excluded:false};}
export async function gatewayExcluded(provider:Gateway){return (await gatewayLifecycle(provider)).excluded===true;}
export async function gatewayEnabled(provider:Gateway){return !await gatewayExcluded(provider)&&!!await credentials(provider);}

// The database closes the race between routing a new order and removing its
// gateway. Existing request IDs remain recoverable through their original API.
export async function ensureGatewayExclusionGuard(){
 await database().prepare(`CREATE TRIGGER IF NOT EXISTS gateway_excluded_new_order BEFORE INSERT ON payment_orders
 WHEN json_extract(COALESCE((SELECT value FROM payment_settings WHERE key='gateway_lifecycle:'||CASE WHEN NEW.provider='beehive_card' THEN 'beehive' ELSE NEW.provider END),'{"excluded":false}'),'$.excluded')=1
 AND NOT EXISTS(SELECT 1 FROM payment_orders WHERE request_id=NEW.request_id)
 BEGIN SELECT RAISE(ABORT,'GATEWAY_EXCLUDED'); END`).run();
}
