import {panelGuard} from '@/lib/gateway-access';
import {selectGateway,preserveGatewaySelection} from '@/lib/gateways';
import {guard,json,readBody} from '@/lib/payments';
import {activateFirebot,firebotKey,FirebotSetupError} from '@/lib/firebot';
export const dynamic='force-dynamic';
export async function GET(req:Request){const denied=await panelGuard(req);if(denied)return denied;try{return json({configured:!!await firebotKey()});}catch{return json({error:'Não foi possível consultar a configuração.'},503);}}
export async function POST(req:Request){const denied=await panelGuard(req);if(denied)return denied;try{const b=await readBody(req);if(![b.secretKey].every(k=>typeof k==='string'&&k.length>=8&&k.length<=1024&&!/[\s\x00-\x1f]/.test(k)))return json({error:'Informe a Secret Key da API Firebot.'},400);if(b.activate===false)await preserveGatewaySelection();if(!await activateFirebot(b.secretKey))return json({error:'A Firebot não validou a chave. A configuração anterior foi preservada.'},422);if(b.activate!==false)await selectGateway('firebot');return json({configured:true});}catch(error){if(error instanceof FirebotSetupError)return json({error:error.message+' A configuração anterior foi preservada.',code:error.code},503);return json({error:'Não foi possível processar a configuração. Atualize a página e tente novamente.'},503);}}
