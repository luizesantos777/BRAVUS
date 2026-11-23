import {createBeehive,beeOrder,backendCustomer} from './beehive';
import {createBeehiveCard} from './beehive-card';
import {createAtlas,atlasOrder} from './atlas';
import {createEleva,elevaOrder} from './eleva';
import {createFirebot,firebotOrder} from './firebot';
import {createGestao,gestaoOrder} from './gestao';
import {createPoseidon,physicalOrder} from './poseidon';
import {createBuckpay} from './create-buckpay';
import {gatewayEnabled} from './gateway-status';
import {credentials,database,json} from './payments';
import type {Gateway} from './gateways';

export async function validatePaymentInput(b:any,provider:Gateway,ip:string){
 if(b.paymentMethod==='credit_card')return;
 if(provider==='atlas')atlasOrder(b,ip);
 else if(provider==='firebot')firebotOrder(b);
 else if(provider==='poseidon')physicalOrder(b);
 else if(provider==='gestao')gestaoOrder(b);
 else if(provider==='eleva')elevaOrder(b);
 else if(provider==='beehive')beeOrder({...b,customer:await backendCustomer(b,null)},ip,true);
}
export async function createPayment(b:any,provider:Gateway,ip:string){
 const previous=await database().prepare('SELECT id FROM payment_orders WHERE request_id=?').bind(b.requestId).first();
 if(!previous&&!await gatewayEnabled(provider))return json({error:'Esta gateway foi excluída ou está indisponível. Atualize a forma de pagamento.',code:'GATEWAY_CHANGED'},409);
 const selected=await credentials(provider);
 if(!selected)return json({error:'Pagamento temporariamente indisponível. Contate o vendedor.'},409);
 if(b.paymentMethod&&b.paymentMethod!=='pix'&&(b.paymentMethod!=='credit_card'||provider!=='beehive'))return json({error:'Forma de pagamento indisponível.'},400);
 if(provider==='beehive')return b.paymentMethod==='credit_card'?createBeehiveCard(b,selected):createBeehive(b,selected,ip);
 if(provider==='atlas')return createAtlas(b,selected,ip);
 if(provider==='eleva')return createEleva(b,selected);
 if(provider==='gestao')return createGestao(b,selected);
 if(provider==='firebot')return createFirebot(b,selected);
 if(provider==='poseidon')return createPoseidon(b,selected);
 return createBuckpay(b);
}
