import {preserveGatewaySelection} from '@/lib/gateways';
import {panelGuard} from '@/lib/gateway-access';
import {credentials,json,readBody} from '@/lib/payments';
import {activateAtlas,atlasKeyValid,atlasWebhookKeyValid,AtlasSetupError} from '@/lib/atlas';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const deny=await panelGuard(req);if(deny)return deny;
 try{const c=await credentials('atlas');return json({configured:!!c,webhookConfigured:!!c?.agent,testMode:c?c.token.startsWith('atlas_sk_test_'):null});}
 catch{return json({error:'Não foi possível consultar a configuração.'},503);}
}
export async function POST(req:Request){
 const deny=await panelGuard(req);if(deny)return deny;
 try{
  const b=await readBody(req),token=typeof b.token==='string'?b.token.trim().replace(/^Bearer\s+/i,''):'';
  const webhookSecret=typeof b.webhookSecret==='string'?b.webhookSecret.trim():undefined;
  if(!atlasKeyValid(token))return json({error:'Informe a chave secreta da Atlas Pags (atlas_sk_live_… ou atlas_sk_test_…).'},400);
  if(webhookSecret&&!atlasWebhookKeyValid(webhookSecret))return json({error:'Confira o segredo do webhook Atlas (whsec_…).'},400);
  if(b.activate===false)await preserveGatewaySelection();if(!await activateAtlas(token,webhookSecret||undefined))return json({error:'Chave recusada pela Atlas. A configuração anterior foi preservada.'},422);
  return json({configured:true});
 }catch(e){return json({error:(e instanceof AtlasSetupError?e.message:'Não foi possível salvar a configuração da Atlas.')+' A configuração anterior foi preservada.'},503);}
}
