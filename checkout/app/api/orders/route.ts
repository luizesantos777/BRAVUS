import {createPayment} from '@/lib/create-payment';
import {fallbackPolicy,gatewayForAmount,gatewaySelection} from '@/lib/gateways';
import {readFallbackRequest,runPaymentFallback} from '@/lib/payment-fallback';
import {InputError as FirebotInputError} from '@/lib/firebot';
import {InputError} from '@/lib/poseidon';
import {publicGuard,json,readBody,database,validId} from '@/lib/payments';
import {BIOCAMISAS_BRAND,checkoutBrandForRequest,checkoutResponse} from '@/lib/checkout-brand';
import {checkoutSellerName,lookupCheckoutAttendant,validCheckoutAttendantId} from '@/lib/checkout-attendant';
import {INVALID_CHECKOUT_AMOUNT,isCheckoutAmount} from '@/lib/checkout-amount';
import {amountLimitResponse,gatewayAmountCheck} from '@/lib/gateway-amount-limits';
import {BeehiveBuyerDetailsRequired} from '@/lib/beehive';
import {biocamisasCustomer} from '@/lib/biocamisas-customer';
import {bravusBuyerForOrder,matchesBravusBuyer} from '@/lib/bravus-checkout-customer';
import type {CheckoutBrand} from '@/lib/checkout-brand';
export const dynamic='force-dynamic';

async function attachCompanyBuyer(b:any,brand:CheckoutBrand,recovering:boolean){
 if(b.customerMode!=='company')return;
 const name=typeof b.customer?.name==='string'?b.customer.name:'';
 const useBravus=b.paymentMethod!=='credit_card'&&brand.id==='bravus'&&matchesBravusBuyer(name);
 const buyer=useBravus?await bravusBuyerForOrder(b.requestId,recovering):
  b.paymentMethod==='credit_card'?null:biocamisasCustomer(brand.id,name);
 if(!buyer){
  if(!useBravus)return json({error:'Cadastro da empresa indisponível para este checkout.'},400);
  if(recovering)return json({error:'Este pedido já foi iniciado com outros dados. Recupere a cobrança original.',code:'ORDER_CHANGED'},409);
  throw new BeehiveBuyerDetailsRequired();
 }
 b.customer=buyer;
 b.customerMode='manual';
}

export async function POST(req:Request){
 const deny=await publicGuard(req);if(deny)return deny;
 try{
  const b=await readBody(req);
  let brand=checkoutBrandForRequest(req);
  if(!isCheckoutAmount(b.amount))return json({error:INVALID_CHECKOUT_AMOUNT},400);
  if(typeof b.requestId!=='string'||!validId(b.requestId))return json({error:'Pedido inválido. Atualize o checkout e tente novamente.'},400);
  const attendantId=b.attendantId??null;
  if(attendantId!==null&&!validCheckoutAttendantId(attendantId))return json({error:'Link de checkout inválido.'},400);
  if(attendantId===null&&b.sellerName!==undefined&&(typeof b.sellerName!=='string'||b.sellerName.trim().length<2||b.sellerName.trim().length>100||/[\x00-\x1f<>]/.test(b.sellerName)))return json({error:'Informe o nome do vendedor (2 a 100 caracteres).'},400);
  if(b.paymentMethod&&b.paymentMethod!=='pix'&&b.paymentMethod!=='credit_card')return json({error:'Forma de pagamento indisponível.'},400);
  b.sellerName=typeof b.sellerName==='string'?b.sellerName.trim():null;
  const saved=await readFallbackRequest(b.requestId);
  const previous=saved?null:await database().prepare('SELECT provider,seller_name,attendant_id,origin FROM payment_orders WHERE request_id=?').bind(b.requestId).first();
  const assignedId=saved?.value.attendant?.id??previous?.attendant_id??null;
  if((saved||previous)&&assignedId!==attendantId)return json({error:'Este pedido já foi iniciado em outro checkout.',code:'ORDER_CHANGED'},409);
  if(attendantId){
   const storedName=saved?.value.attendant?.name??previous?.seller_name;
   if(typeof storedName==='string'){
    b.sellerName=storedName;
    if((saved?.value.checkoutOrigin??previous?.origin)===BIOCAMISAS_BRAND.origin)brand=BIOCAMISAS_BRAND;
   }
   else{
    const attendant=await lookupCheckoutAttendant(attendantId);
    if(!attendant)return json({error:'Este checkout de atendente está indisponível.'},404);
    b.sellerName=checkoutSellerName(attendant.name);
    if(attendant.kind==='partner')brand=BIOCAMISAS_BRAND;
   }
  }
  b.attendantId=attendantId;
  b.checkoutOrigin=brand.origin;
  const withCheckoutDomain=async(result:Promise<Response>)=>checkoutResponse(req,await result,brand);
  const policy=await fallbackPolicy(),selection=await gatewaySelection(),ip=req.headers.get('cf-connecting-ip')||'';
  if(saved||previous){
   const companyError=await attachCompanyBuyer(b,brand,true);
   if(companyError)return companyError;
  }
  // Recover the recorded chain even after the owner changes routing or disables fallback.
  if(saved)return await withCheckoutDomain(runPaymentFallback(b,ip,policy,{provider:selection.provider,selection,byTicket:false},saved));
  if(previous){
   if(previous.seller_name!==(b.sellerName||null))return json({error:'Este pedido já foi iniciado com outro vendedor.'},409);
   const provider=previous.provider==='beehive_card'?'beehive':previous.provider;
   if((previous.provider==='beehive_card')!==(b.paymentMethod==='credit_card'))return json({error:'Este pedido já foi iniciado com outra forma de pagamento.'},409);
   return await withCheckoutDomain(createPayment(b,provider,ip));
  }
  // Ticket rules and fallback apply to PIX. Card links remain with Beehive.
  const route=b.paymentMethod==='credit_card'?{provider:selection.provider,selection,byTicket:false,available:!selection.suspended}:await gatewayForAmount(b.amount,policy,selection);
  if(!route.available)return json({error:'As gateways estão temporariamente indisponíveis. Aguarde alguns minutos ou contate o vendedor.',code:'GATEWAYS_UNAVAILABLE'},409);
  if(typeof b.provider==='string'&&b.provider!==route.provider)return json({error:'A forma de pagamento foi atualizada. Confira os dados e tente novamente.',code:'GATEWAY_CHANGED'},409);
  if(b.paymentMethod==='credit_card'&&route.provider!=='beehive')return json({error:'Forma de pagamento indisponível.'},400);
  const amountCheck=await gatewayAmountCheck(route.provider,b.paymentMethod==='credit_card'?'credit_card':'pix',b.amount);
  if(amountCheck.status==='outside_limits')return amountLimitResponse(amountCheck);
  const companyError=await attachCompanyBuyer(b,brand,false);
  if(companyError)return companyError;
  if(policy.enabled&&b.paymentMethod!=='credit_card')return await withCheckoutDomain(runPaymentFallback(b,ip,policy,route,null));
  return await withCheckoutDomain(createPayment(b,route.provider,ip));
 }catch(error){
  if(error instanceof BeehiveBuyerDetailsRequired)return json({error:error.message,code:'BUYER_DETAILS_REQUIRED'},400);
  if(error instanceof InputError||error instanceof FirebotInputError)return json({error:error.message},400);
  return json({error:'Não foi possível gerar o link. Recupere o mesmo pedido para conferir o resultado.'},503);
 }
}
