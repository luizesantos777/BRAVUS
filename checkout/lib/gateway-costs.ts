import {database} from './payments';
import type {Gateway} from './gateways';
export type GatewayCost={basisPoints:number;fixedCents:number;rounding:'nearest'|'up';revision:string;updatedAt:number};
export const costKey=(provider:Gateway)=>'gateway_cost:'+provider;
export function validateGatewayCost(value:any){
 if(!value||!Number.isSafeInteger(value.basisPoints)||value.basisPoints<0||value.basisPoints>10000||!Number.isSafeInteger(value.fixedCents)||value.fixedCents<0||value.fixedCents>300000||!['nearest','up'].includes(value.rounding))throw Error('Informe um percentual entre 0% e 100%, um custo fixo de até R$ 3.000,00 e o arredondamento.');
 return {basisPoints:value.basisPoints as number,fixedCents:value.fixedCents as number,rounding:value.rounding as GatewayCost['rounding']};
}
export function calculateGatewayCost(amount:number,cost:Pick<GatewayCost,'basisPoints'|'fixedCents'|'rounding'>){return Math.floor((amount*cost.basisPoints+(cost.rounding==='up'?9999:5000))/10000)+cost.fixedCents;}
export async function gatewayCost(provider:Gateway):Promise<GatewayCost|null>{const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind(costKey(provider)).first();return row?JSON.parse(row.value):null;}

export async function saveGatewayCost(provider:Gateway,input:unknown){
 const cost={...validateGatewayCost(input),revision:crypto.randomUUID(),updatedAt:Date.now()},db=database();
 // Snapshot in the SAME SQLite transaction as order creation, for every adapter
 // and concurrent request. Future edits cannot reprice an older charge.
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS gateway_cost_new_order AFTER INSERT ON payment_orders BEGIN
 INSERT INTO payment_settings (key,value) VALUES ('gateway_cost_order:'||NEW.id,json_object('provider',CASE WHEN NEW.provider='beehive_card' THEN 'beehive' ELSE NEW.provider END,'amount',NEW.amount,'createdAt',NEW.created_at,'rate',json(COALESCE((SELECT value FROM payment_settings WHERE key='gateway_cost:'||CASE WHEN NEW.provider='beehive_card' THEN 'beehive' ELSE NEW.provider END),'null')))) ON CONFLICT(key) DO NOTHING;
 END`).run();
 await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(costKey(provider),JSON.stringify(cost)).run();return cost;
}

export async function gatewayCostSummary(){
 const since=Date.now()-30*86400000;
 const costs=await database().prepare(`SELECT CASE WHEN p.provider='beehive_card' THEN 'beehive' ELSE p.provider END AS provider,COUNT(*) AS sales,SUM(p.amount) AS grossCents,
 SUM(CASE WHEN json_type(a.value,'$.fee') IN ('integer','real') THEN CAST(round(json_extract(a.value,'$.fee')*100) AS INTEGER)
 WHEN json_type(s.value,'$.rate')='object' THEN CAST((p.amount*json_extract(s.value,'$.rate.basisPoints')+CASE WHEN json_extract(s.value,'$.rate.rounding')='up' THEN 9999 ELSE 5000 END)/10000 AS INTEGER)+json_extract(s.value,'$.rate.fixedCents') ELSE 0 END) AS costCents,
 SUM(CASE WHEN json_type(a.value,'$.fee') IN ('integer','real') THEN 1 ELSE 0 END) AS actualSales,
 SUM(CASE WHEN json_type(a.value,'$.fee') IN ('integer','real') OR json_type(s.value,'$.rate')='object' THEN 0 ELSE 1 END) AS unpricedSales
 FROM payment_orders p LEFT JOIN payment_settings s ON s.key='gateway_cost_order:'||p.id LEFT JOIN payment_settings a ON p.provider='atlas' AND a.key='atlas_charge:'||p.id
 WHERE p.state='paid' AND p.created_at>=? GROUP BY CASE WHEN p.provider='beehive_card' THEN 'beehive' ELSE p.provider END`).bind(since).all();
 return {since,rows:costs.results};
}
