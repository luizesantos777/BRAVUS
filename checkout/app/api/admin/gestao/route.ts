import {panelGuard} from '@/lib/gateway-access';
import {selectGateway,preserveGatewaySelection} from '@/lib/gateways';
import {guard,json,readBody} from '@/lib/payments';
import {activateGestao,gestaoKey,GestaoSetupError} from '@/lib/gestao';
export const dynamic='force-dynamic';
export async function GET(req:Request){const denied=await panelGuard(req);if(denied)return denied;try{return json({configured:!!await gestaoKey()});}catch{return json({error:'Não foi possível consultar a configuração.'},503);}}
export async function POST(req:Request){const denied=await panelGuard(req);if(denied)return denied;try{const b=await readBody(req);if(![b.publicKey,b.secretKey].every(k=>typeof k==='string'&&k.length>=8&&k.length<=1024&&!/[^\x21-\x7e]|:/.test(k)))return json({error:'Informe as chaves pública e privada da API Gestão Pay.'},400);if(b.activate===false)await preserveGatewaySelection();if(!await activateGestao(b.publicKey,b.secretKey))return json({error:'A Gestão Pay não validou a chave. A configuração anterior foi preservada.'},422);if(b.activate!==false)await selectGateway('gestao');return json({configured:true});}catch(error){if(error instanceof GestaoSetupError)return json({error:error.message+' A configuração anterior foi preservada.',code:error.code},503);return json({error:'Não foi possível processar a configuração. Atualize a página e tente novamente.'},503);}}
