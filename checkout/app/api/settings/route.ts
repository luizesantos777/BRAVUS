import {gatewayEnabled} from '@/lib/gateway-status';
import {panelGuard} from '@/lib/gateway-access';
import {fallbackPolicy,gatewayForAmount,gatewaySelection,preserveGatewaySelection} from '@/lib/gateways';
import {publicGuard,json,readBody,credentials,saveCredentials} from '@/lib/payments';
import {isCheckoutAmount,INVALID_CHECKOUT_AMOUNT} from '@/lib/checkout-amount';
import {amountLimitResponse,gatewayAmountCheck} from '@/lib/gateway-amount-limits';
import {checkoutBrandForRequest} from '@/lib/checkout-brand';
import {registeredBravusBuyer} from '@/lib/bravus-checkout-customer';
import {pixBuyerFields} from '@/lib/checkout-buyer-fields';
export const dynamic='force-dynamic';
export async function GET(req:Request){const deny=await publicGuard(req);if(deny)return deny;try{
 const raw=new URL(req.url).searchParams.get('amount');
 if(raw!==null&&(!/^\d{1,10}$/.test(raw)||!isCheckoutAmount(Number(raw))))return json({error:INVALID_CHECKOUT_AMOUNT},400);
 const method=new URL(req.url).searchParams.get('method');if(method!==null&&method!=='pix'&&method!=='credit_card')return json({error:'Forma de pagamento indisponível.'},400);
 const selected=await gatewaySelection();
 const route=method==='credit_card'?{provider:selected.provider,available:!selected.suspended}:await gatewayForAmount(raw===null?undefined:Number(raw),undefined,selected);
 const configured=route.available&&(method!=='credit_card'||route.provider==='beehive')&&await gatewayEnabled(route.provider);
 const amountCheck=configured&&raw!==null?await gatewayAmountCheck(route.provider,method??'pix',Number(raw)):null;
 if(amountCheck?.status==='outside_limits')return amountLimitResponse(amountCheck);
 const detailed=new URL(req.url).searchParams.get('requirements')==='1';
 let fullIdentity=false,bravusCompanyAvailable=false;
 let buyerFields=pixBuyerFields([]);
 if(detailed&&method!=='credit_card'){
  const policy=await fallbackPolicy();
  const reserves=policy.enabled?await Promise.all(policy.order.filter(provider=>provider!==route.provider).map(async provider=>await gatewayEnabled(provider)?provider:null)):[];
  const providers=[route.provider,...reserves.filter(provider=>provider!==null)];
  fullIdentity=route.provider!=='beehive'&&providers.includes('atlas');
  buyerFields=pixBuyerFields(providers);
  if(configured&&checkoutBrandForRequest(req).id==='bravus'){
   bravusCompanyAvailable=!!await registeredBravusBuyer();
  }
 }
 return json({configured,provider:route.provider,...(detailed?{buyerRequirements:{fullIdentity,bravusCompanyAvailable,...buyerFields},...(amountCheck?{amountCheck}:{})}:{})});
}catch{return json({error:'Não foi possível consultar a configuração.'},503);}}
export async function POST(req:Request){const deny=await panelGuard(req);if(deny)return deny;try{const b=await readBody(req);if(await credentials()&&b.replace!==true)return json({error:'As credenciais BuckPay já estão configuradas e bloqueadas para alteração.'},409);if(typeof b.token!=='string'||b.token.length!==40||/[\r\n\s]/.test(b.token)||typeof b.agent!=='string'||!b.agent.trim()||b.agent.length>500||/[\r\n]/.test(b.agent))return json({error:'Informe o token de 40 caracteres e o User-Agent fornecidos pela BuckPay.'},400);if(b.activate===false)await preserveGatewaySelection();await saveCredentials(b.token,b.agent.trim());return json({configured:true});}catch{return json({error:'Não foi possível salvar. Tente novamente.'},503);}}
