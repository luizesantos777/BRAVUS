import {panelGuard} from '@/lib/gateway-access';
import {json,readBody,credentials} from '@/lib/payments';
import {gatewaySelection,gateways,isGateway,selectGateway,fallbackPolicy,saveFallbackPolicy,gatewayHealth,lastGatewaySwitch} from '@/lib/gateways';
import {gatewayLifecycle} from '@/lib/gateway-status';
import {gatewayCost,gatewayCostSummary,saveGatewayCost} from '@/lib/gateway-costs';
import {gatewayAmountLimits,saveGatewayAmountLimits} from '@/lib/gateway-amount-limits';
import {excludeGateway,restoreGateway} from '@/lib/gateway-management';
export const dynamic='force-dynamic';
export async function GET(req:Request){const denied=await panelGuard(req);if(denied)return denied;try{
 const selection=await gatewaySelection();
 const providers=await Promise.all(gateways.map(async id=>{const [health,lifecycle,cost,amountLimits]=await Promise.all([gatewayHealth(id),gatewayLifecycle(id),gatewayCost(id),gatewayAmountLimits(id)]);return {id,configured:!!await credentials(id),excluded:lifecycle.excluded,managementRevision:lifecycle.revision||'legacy',cost,amountLimits,pausedUntil:health?.epoch===selection.epoch?health.failedUntil:null};}));
 return json({active:selection.provider,paused:!!selection.suspended,providers,fallback:await fallbackPolicy(),lastSwitch:await lastGatewaySwitch(),costSummary:await gatewayCostSummary()});
}catch{return json({error:'Não foi possível carregar as gateways. Atualize a página.'},503);}}
export async function POST(req:Request){const denied=await panelGuard(req);if(denied)return denied;try{
 const b=await readBody(req);
 if(b.action!==undefined){
  if(!isGateway(b.provider)||b.fallback!==undefined)return json({error:'Escolha uma gateway válida para esta ação.'},400);
  try{
   if(b.action==='cost')return json({cost:await saveGatewayCost(b.provider,b.cost)});
   if(b.action==='amount-limits')return json({amountLimits:await saveGatewayAmountLimits(b.provider,b.amountLimits)});
   if(b.action==='exclude'){
    if(b.replacement!==undefined&&!isGateway(b.replacement))return json({error:'Escolha uma gateway substituta válida.'},400);
    await excludeGateway(b.provider,b.replacement,b.pauseCheckout===true);return json({excluded:true});
   }
   if(b.action==='restore'){await restoreGateway(b.provider);return json({restored:true});}
   return json({error:'Ação inválida.'},400);
  }catch(error){return json({error:(error as Error).message},409);}
 }
 if(b.fallback!==undefined){
  if(b.provider!==undefined)return json({error:'Salve a gateway padrão e as regras separadamente.'},400);
  try{return json({fallback:await saveFallbackPolicy(b.fallback)});}catch(error){return json({error:(error as Error).message},400);}
 }
 if(!isGateway(b.provider))return json({error:'Escolha uma gateway válida.'},400);
 if(!await selectGateway(b.provider))return json({error:'Cadastre as credenciais desta gateway antes de ativá-la.'},409);
 return json({active:b.provider});
}catch{return json({error:'Não foi possível salvar. Atualize a página para conferir a configuração.'},503);}}
