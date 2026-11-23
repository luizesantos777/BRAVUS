import {preserveGatewaySelection} from '@/lib/gateways';
import {panelGuard} from '@/lib/gateway-access';
import {json,readBody,credentials} from '@/lib/payments';
import {activateEleva,ElevaSetupError} from '@/lib/eleva';
export const dynamic='force-dynamic';
export async function GET(req:Request){const deny=await panelGuard(req);if(deny)return deny;try{return json({configured:!!await credentials('eleva')});}catch{return json({error:'Não foi possível consultar a configuração.'},503);}}
export async function POST(req:Request){const deny=await panelGuard(req);if(deny)return deny;try{const b=await readBody(req);if(typeof b.token==='string')b.token=b.token.trim().replace(/^Bearer\s+/i,'');if(typeof b.clientId==='string')b.clientId=b.clientId.trim();if(![b.token,b.clientId].every(v=>typeof v==='string'&&v.length>=3&&v.length<=1024&&!/[^\x21-\x7e]/.test(v)))return json({error:'Informe o Token e o Client ID da API Eleva.'},400);if(b.activate===false)await preserveGatewaySelection();if(!await activateEleva(b.token,b.clientId))return json({error:'Credenciais recusadas pela Eleva. A configuração anterior foi preservada.'},422);return json({configured:true});}catch(e){return json({error:e instanceof ElevaSetupError?e.message+' A configuração anterior foi preservada.':'Não foi possível salvar a configuração da Eleva.'},503);}}
