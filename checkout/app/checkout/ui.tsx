'use client';
import {useEffect,useRef,useState} from 'react';
import {restoreAttempt,saveAttempt,clearAttempt} from '@/lib/checkout-session';
import type {Attempt} from '@/lib/checkout-session';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import CheckoutMark from '@/components/checkout-mark';
import {maskGateway} from '@/lib/gateway-mask';
import {BIOCAMISAS_BUYER_NAME,BRAVUS_BUYER_NAME} from '@/lib/checkout-buyer-names';
import {BRAVUS_BRAND} from '@/lib/checkout-brand';
import {INVALID_CHECKOUT_AMOUNT,parseCheckoutAmount} from '@/lib/checkout-amount';
import type {CheckoutBrand} from '@/lib/checkout-brand';
import type {CheckoutAttendant} from '@/lib/checkout-attendant';
const ELEVA_EMAIL='Bravus.Suporte@gmail.com';
const fields=[['name','Nome completo','name'],['email','E-mail','email'],['cpf','CPF ou CNPJ','off'],['phone','Telefone com DDD','tel']];
type CheckoutSettings={configured?:boolean;provider:string;buyerRequirements?:{fullIdentity?:boolean;buyerDetailsRequired?:boolean;phoneRequired?:boolean;bravusCompanyAvailable?:boolean}};
function buyerFields(settings:CheckoutSettings){
 const requirements=settings.buyerRequirements;
 return {details:requirements?.buyerDetailsRequired??requirements?.fullIdentity??false,phone:requirements?.phoneRequired===true};
}
export default function Checkout({canConfigure,brand=BRAVUS_BRAND,partnerName,attendant}:{canConfigure:boolean;brand?:CheckoutBrand;partnerName?:string;attendant?:CheckoutAttendant}){
 const [paymentMethod,setPaymentMethodState]=useState<'pix'|'credit_card'>('pix'),[configured,setConfigured]=useState(false),[provider,setProvider]=useState(''),[loaded,setLoaded]=useState(false),[sellerName,setSellerName]=useState(''),[amount,setAmountState]=useState(''),[values,setValues]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[checkingAmount,setCheckingAmount]=useState(false),[error,setError]=useState(''),[url,setUrl]=useState(''),[attempted,setAttempted]=useState(false),[copied,setCopied]=useState(false),[identityRequired,setIdentityRequired]=useState(false),[rejected,setRejected]=useState(false);
 const [manualBuyer,setManualBuyer]=useState<boolean>();
 const [bravusCompanyAvailable,setBravusCompanyAvailable]=useState(false);
 const [buyerRequirements,setBuyerRequirements]=useState({details:false,phone:false});
 const [submittedCustomerMode,setSubmittedCustomerMode]=useState<Attempt['customerMode']>();
 const request=useRef(''),sending=useRef(false),autoBuyerName=useRef(false),waitingForBuyerDetails=useRef(false),syncRetry=useRef(false),syncedProvider=useRef<string|null>(null),syncedBuyerRequirements=useRef<{details:boolean;phone:boolean}|null>(null);
 const setAmount=(value:string)=>{setAmountState(value);if(!request.current&&!attempted)setCheckingAmount(parseCheckoutAmount(value)!==null);};
 const setPaymentMethod=(value:'pix'|'credit_card')=>{setPaymentMethodState(value);if(!request.current&&!attempted&&parseCheckoutAmount(amount)!==null)setCheckingAmount(true);};
 const buyerName=brand.id==='biocamisas'?BIOCAMISAS_BUYER_NAME:BRAVUS_BUYER_NAME;
 const attendantId=attendant?.id;
 const attemptScope=attendantId?`attendant:${attendantId}`:undefined;
 const designatedSeller=attendant?.name??partnerName;
 const isPartnerLink=attendant?.kind==='partner'||!!partnerName;
 const companyBuyerAvailable=configured&&(brand.id==='biocamisas'||bravusCompanyAvailable);
 const wantsManualBuyer=manualBuyer??(!companyBuyerAvailable&&buyerRequirements.details);
 const missingBravusBeehiveProfile=brand.id==='bravus'&&provider==='beehive'&&!bravusCompanyAvailable;
 const lockedBuyer=attempted||!!request.current&&!waitingForBuyerDetails.current;
 let customerMode:Attempt['customerMode'];
 if(paymentMethod==='pix'){
  if(lockedBuyer)customerMode=submittedCustomerMode;
  else if(wantsManualBuyer)customerMode=buyerRequirements.details?'manual':undefined;
  else if(companyBuyerAvailable)customerMode='company';
 }
 const usingCompanyBuyer=customerMode==='company';
 const needsIdentity=paymentMethod==='pix'&&!usingCompanyBuyer&&(provider==='atlas'||identityRequired||customerMode==='manual');
 const settingsUrl=(cents?:number,method=paymentMethod)=>'/api/settings?requirements=1&method='+method+(cents===undefined?'':'&amount='+cents);
 function applyPaymentSettings(data:CheckoutSettings,keepRestoredProvider=false){
  setConfigured(data.configured===true);
  setIdentityRequired(data.buyerRequirements?.fullIdentity===true);
  setBravusCompanyAvailable(data.buyerRequirements?.bravusCompanyAvailable===true);
  setBuyerRequirements(buyerFields(data));
  setProvider(current=>keepRestoredProvider&&current?current:data.provider);
 }
 useEffect(()=>{try{const saved=restoreAttempt(sessionStorage,attemptScope);if(saved.attempt){const a=saved.attempt;request.current=a.requestId;setSellerName(a.sellerName);setAmount(a.amount);setProvider(a.provider);setPaymentMethod(a.paymentMethod==='credit_card'?'credit_card':'pix');setManualBuyer(a.customerMode==='manual');setSubmittedCustomerMode(a.customerMode);setValues(a.values);setUrl(a.url||'');setAttempted(true);}else if(saved.legacy){setAttempted(true);setError('Há um pedido antigo salvo nesta guia. Confira a cobrança anterior e clique em Iniciar outro pedido para gerar um novo PIX.');}}catch{}fetch('/api/settings?requirements=1',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.error)throw Error(d.error);applyPaymentSettings(d,true);setLoaded(true)}).catch(()=>{setLoaded(true);setError('Não foi possível carregar o pagamento. Atualize a página.')});},[attemptScope]);
 useEffect(()=>{
  if(!loaded||attempted||(request.current&&!waitingForBuyerDetails.current)||busy||syncRetry.current)return;
  const cents=parseCheckoutAmount(amount);
  if(cents===null)return;
  const controller=new AbortController();const timer=setTimeout(async()=>{try{
   const r=await fetch(settingsUrl(cents),{cache:'no-store',signal:controller.signal}),d=await r.json();
   if(!controller.signal.aborted&&(!request.current||waitingForBuyerDetails.current)&&!sending.current){
    if(d.code==='AMOUNT_LIMIT'){setError(d.error);return;}
    if(!r.ok||d.error)throw Error();
    applyPaymentSettings(d);
    if(d.provider!=='beehive'&&paymentMethod==='credit_card')setPaymentMethodState('pix');
   }
  }catch{if(!controller.signal.aborted)setError('Não foi possível conferir a forma de pagamento para este valor. Tente novamente.');}
  finally{if(!controller.signal.aborted)setCheckingAmount(false);}},300);
  return()=>{clearTimeout(timer);controller.abort();};
 },[amount,loaded,attempted,paymentMethod,busy]);
 useEffect(()=>{if(attempted||request.current)return;if(needsIdentity&&autoBuyerName.current){setValues(current=>({...current,name:current.name===buyerName?'':current.name}));autoBuyerName.current=false;}else if(provider==='beehive'&&!needsIdentity&&!missingBravusBeehiveProfile)setValues(current=>{if(current.name!==undefined)return current;autoBuyerName.current=true;return {...current,name:buyerName};});},[provider,attempted,needsIdentity,buyerName,missingBravusBeehiveProfile]);
 function showBuyerDetails(clearPreset=autoBuyerName.current){
  if(clearPreset)setValues(current=>({...current,name:current.name===buyerName?'':current.name}));
  autoBuyerName.current=false;
  setManualBuyer(true);
 }
 async function create(e:React.FormEvent){e.preventDefault();if(sending.current||url)return;const form=e.currentTarget;setError('');const cents=parseCheckoutAmount(amount);if(cents===null){setError(INVALID_CHECKOUT_AMOUNT);return;}sending.current=true;setBusy(true);let tab:Window|null=null;
 const effectiveSeller=designatedSeller??(provider==='beehive'&&!attempted?'':sellerName.trim());setSellerName(effectiveSeller);
 try{
 try{tab=window.open('about:blank','_blank');if(tab)tab.opener=null;}catch{tab=null;}
 if(!attempted&&(!request.current||waitingForBuyerDetails.current)){
  const check=await fetch(settingsUrl(cents),{cache:'no-store'}),fresh=await check.json();
  if(!check.ok||fresh.error)throw Error(fresh.code==='AMOUNT_LIMIT'?fresh.error:'Não foi possível conferir a forma de pagamento. Tente novamente.');
  const freshFields=buyerFields(fresh);
  const expectedProvider=syncRetry.current&&syncedProvider.current?syncedProvider.current:provider;
  const expectedBuyerRequirements=syncRetry.current&&syncedBuyerRequirements.current?syncedBuyerRequirements.current:buyerRequirements;
  const requirementsChanged=paymentMethod==='pix'&&!usingCompanyBuyer&&
   (freshFields.details!==expectedBuyerRequirements.details||freshFields.phone!==expectedBuyerRequirements.phone);
  if(fresh.provider!==expectedProvider||requirementsChanged){
   applyPaymentSettings(fresh);if(fresh.provider!=='beehive')setPaymentMethodState('pix');
   if(!syncRetry.current){
    syncRetry.current=true;syncedProvider.current=fresh.provider;syncedBuyerRequirements.current=freshFields;tab?.close();sending.current=false;setBusy(false);setError('');
    setTimeout(()=>{if(!url&&!sending.current)form.requestSubmit();},0);
    return;
   }
   syncRetry.current=false;syncedProvider.current=null;syncedBuyerRequirements.current=null;
   throw Error('A forma de pagamento foi atualizada para este valor. Confira os dados e toque em gerar novamente.');
  }
  syncRetry.current=false;syncedProvider.current=null;syncedBuyerRequirements.current=null;
  if(usingCompanyBuyer&&brand.id==='bravus'&&!fresh.buyerRequirements?.bravusCompanyAvailable){
   applyPaymentSettings(fresh);showBuyerDetails();
   throw Error(freshFields.details?'Preencha os dados do comprador para gerar o PIX.':'O cadastro da empresa está indisponível. Tente gerar o PIX novamente.');
  }
  if(!fresh.configured)throw Error('Pagamento temporariamente indisponível. Contate o vendedor.');
 }
 request.current ||= crypto.randomUUID();
 waitingForBuyerDetails.current=false;
 const attemptValues=usingCompanyBuyer?{name:buyerName}:values;
 const attempt:Attempt={requestId:request.current,sellerName:effectiveSeller,amount,provider,paymentMethod,customerMode,values:attemptValues};
 try{saveAttempt(sessionStorage,attempt,attemptScope)}catch{}
 const {name,email=!needsIdentity&&['eleva','gestao'].includes(provider)?ELEVA_EMAIL:undefined,cpf,phone,address,...shipping}=attemptValues;
 const buyer={name,email,cpf,phone};
 const customer=paymentMethod==='credit_card'?{}:usingCompanyBuyer?{name}:needsIdentity||provider==='atlas'?buyer
  :provider==='beehive'?(attempted?buyer:{name})
  :provider==='eleva'?(attempted&&name&&cpf?{name,email,cpf}:{email})
  :provider==='gestao'?(attempted&&name&&cpf?{...buyer,address}:{email,phone})
  :provider==='poseidon'?{...buyer,address}:{};
 setSubmittedCustomerMode(customerMode);setAttempted(true);
 const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sellerName:effectiveSeller||undefined,attendantId,provider,paymentMethod,customerMode,amount:cents,requestId:request.current,customer,shipping})});
 const d=await r.json();
 if(!r.ok){
  setRejected(d.retryMode==='new_order'&&d.provider==='atlas');
  if(r.status===400&&d.code==='BUYER_DETAILS_REQUIRED'&&(provider==='beehive'||usingCompanyBuyer)&&paymentMethod==='pix'){
   waitingForBuyerDetails.current=true;
   try{clearAttempt(sessionStorage,attemptScope)}catch{}
   showBuyerDetails(autoBuyerName.current||(attempted&&name===buyerName));
   setAttempted(false);
   throw Error(buyerRequirements.details?'Preencha os dados do comprador para gerar o PIX.':'O cadastro da empresa está indisponível. Tente gerar o PIX novamente.');
  }
  if(d.code==='GATEWAY_CHANGED'){
   request.current='';try{clearAttempt(sessionStorage,attemptScope)}catch{}
   const fresh=await fetch(settingsUrl(cents),{cache:'no-store'}).then(r=>r.json());
   applyPaymentSettings(fresh);setPaymentMethod('pix');setAttempted(false);
  }
  if(r.status===400)setAttempted(false);
  throw Error(maskGateway(d.error)||'Não foi possível concluir a solicitação. Confira a cobrança antes de gerar outra.');
 }
 try{saveAttempt(sessionStorage,{...attempt,url:d.url},attemptScope);}catch{}
 setUrl(d.url);if(tab&&!tab.closed)tab.location.href=d.url;else window.location.assign(d.url);
 }catch(e){tab?.close();setError(e instanceof Error?e.message:'Não foi possível concluir. Confira com o vendedor antes de gerar outro PIX.');}finally{sending.current=false;setBusy(false)}}
 async function newOrder(keepDetails=false){
  if(sending.current||keepDetails&&!rejected||!keepDetails&&!window.confirm('Confira com o vendedor se já existe uma cobrança para este pedido. Deseja iniciar outro pagamento?'))return;
  sending.current=true;setBusy(true);
  try{
   const r=await fetch('/api/settings?requirements=1',{cache:'no-store'}),fresh=await r.json();
   if(!r.ok||fresh.error||typeof fresh.provider!=='string')throw Error('Não foi possível carregar a forma de pagamento atual. Tente novamente.');
   request.current='';waitingForBuyerDetails.current=false;try{clearAttempt(sessionStorage,attemptScope)}catch{}
   applyPaymentSettings(fresh);setPaymentMethod('pix');setLoaded(true);
   setAttempted(false);setSubmittedCustomerMode(undefined);setRejected(false);setUrl('');
   if(!keepDetails){autoBuyerName.current=false;setManualBuyer(undefined);setAmount('');setValues({});}
   else if(companyBuyerAvailable&&submittedCustomerMode!=='company')setManualBuyer(true);
   setError('');setCopied(false);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível iniciar outro pedido.');}
  finally{sending.current=false;setBusy(false)}
 }

 return <main className="pay-shell checkout-page" data-checkout-brand={brand.id}><header className="checkout-header"><div className="pay-brand"><CheckoutMark brand={brand}/><div><strong>{brand.wordmark}</strong><small>{provider==='beehive'?'PIX ou cartão de crédito':'Pagamento via PIX'}</small></div></div><span className="checkout-status">Pagamento seguro</span></header><section className="checkout-intro">{designatedSeller&&<span className="partner-badge">{isPartnerLink?'Checkout do parceiro':'Checkout do atendente'} <strong>{designatedSeller}</strong></span>}<span className="secure">Compra segura</span><h1>{paymentMethod==='credit_card'?'Pague com cartão de crédito':'Finalize seu pedido via PIX'}</h1><p className="muted">{paymentMethod==='credit_card'?`Gere o link e envie ao cliente. O cliente preenche os dados e paga na página da ${brand.name}.`:usingCompanyBuyer?'Informe o valor combinado com o vendedor.':needsIdentity||['poseidon','gestao','eleva','beehive','atlas'].includes(provider)?'Informe o valor combinado com o vendedor e os dados do comprador.':'Informe o valor da compra para gerar seu PIX.'}</p></section><section className="pay-card checkout-card"><form onSubmit={create}><fieldset disabled={busy||attempted} className="checkout-fields">{provider==='beehive'&&<label className="field checkout-field"><span>Forma de pagamento</span><select value={paymentMethod} onChange={e=>{setError('');setPaymentMethod(e.target.value as 'pix'|'credit_card');}} className="method-select"><option value="pix">PIX</option><option value="credit_card">Cartão de crédito — até 12x</option></select></label>}{designatedSeller?<label className="field checkout-field"><span>{isPartnerLink?'Parceiro responsável':'Atendente responsável'}</span><Input value={designatedSeller} readOnly autoComplete="off"/></label>:provider!=='beehive'&&<label className="field checkout-field"><span>Nome do vendedor</span><Input value={sellerName} onChange={e=>setSellerName(e.target.value)} placeholder="Quem está gerando este PIX?" autoComplete="off" minLength={2} maxLength={100} required/></label>}<label className="field checkout-field"><span>Valor total da compra</span><div className="currency-input"><b>R$</b><Input value={amount} onChange={e=>{setError('');setAmount(e.target.value);}} placeholder="99,89" inputMode="decimal" required/></div></label><p className="field-note">Digite o valor da sua compra, por exemplo R$ 99,89, conforme combinado com o vendedor.</p>{paymentMethod==='pix'&&(usingCompanyBuyer||needsIdentity||['poseidon','gestao','eleva','beehive','atlas'].includes(provider))&&<><h2>Dados do comprador</h2>{companyBuyerAvailable&&buyerRequirements.details&&!lockedBuyer&&<Button type="button" variant="outline" onClick={()=>{if(usingCompanyBuyer)showBuyerDetails();else setManualBuyer(false);setError('');}}>{usingCompanyBuyer?'Informar outro comprador':brand.id==='biocamisas'?'Usar cadastro da Bio Camisas':'Usar cadastro da Bravus'}</Button>}{missingBravusBeehiveProfile&&needsIdentity&&!lockedBuyer&&<Button type="button" variant="outline" onClick={()=>{setManualBuyer(false);setError('');}}>Usar nome já cadastrado</Button>}{provider==='beehive'&&!needsIdentity&&!usingCompanyBuyer&&<><p className="field-note">O nome cadastrado preenche os demais dados do comprador.</p><Button type="button" variant="outline" onClick={()=>{showBuyerDetails();setError('');}}>Preencher dados do comprador</Button></>}{!needsIdentity&&['eleva','gestao'].includes(provider)&&<p className="field-note">Nome e CPF vinculados automaticamente ao cadastro configurado.</p>}<div className="buyer-grid">{fields.filter(([key])=>usingCompanyBuyer?key==='name':needsIdentity?true:provider==='beehive'?key==='name':provider==='eleva'?key==='email':provider==='gestao'?['email','phone'].includes(key):true).map(([key,label,auto])=><label className={'field '+(['name','email','street','complement','address'].includes(key)?'wide':'')} key={key}><span>{provider==='eleva'&&key==='name'?'Nome do cliente':label}</span><Input name={key} type={key==='email'?'email':'text'} autoComplete={auto} readOnly={usingCompanyBuyer} value={usingCompanyBuyer?buyerName:values[key]??(!needsIdentity&&['eleva','gestao'].includes(provider)&&key==='email'?ELEVA_EMAIL:'')} onChange={e=>{if(key==='name')autoBuyerName.current=false;if(needsIdentity&&!lockedBuyer)setManualBuyer(true);setValues({...values,[key]:e.target.value});}} required={key!=='phone'||buyerRequirements.phone} maxLength={key==='state'?2:key==='email'?254:key==='address'?500:needsIdentity&&key==='name'?120:needsIdentity&&key==='phone'?30:150} inputMode={['cpf','phone','zipCode'].includes(key)?'numeric':'text'} placeholder={key==='phone'?'DDD + número do comprador':key==='state'?'SP':key==='number'?'Número ou S/N':undefined}/></label>)}</div></>}</fieldset><Button className="action" type="submit" disabled={!configured||busy||checkingAmount||!!url||rejected||(provider!=='beehive'&&!(designatedSeller??sellerName.trim()))||!amount}>{checkingAmount?'Conferindo forma de pagamento…':busy?'Gerando pagamento…':rejected?'Cobrança recusada':attempted?'Recuperar o mesmo pedido':paymentMethod==='credit_card'?'Gerar link de cartão':'Gerar PIX em nova guia'}</Button></form>{!configured&&<p className="muted">{loaded?'O pagamento está temporariamente indisponível.':'Preparando o pagamento…'}</p>}{error&&<p role="alert" className="error">{error}</p>}{attempted&&!url&&!busy&&!rejected&&<p className="muted">Uma nova tentativa recupera o mesmo pedido. Se o resultado estiver indefinido, confira com o vendedor antes de iniciar outra cobrança.</p>}{url&&<div className="success checkout-result"><strong>{paymentMethod==='credit_card'?'Link de cartão pronto':'Seu PIX está pronto'}</strong><p><a className="result-link" href={url} target="_blank" rel="noopener noreferrer">Abrir página de pagamento</a></p><Button className="action" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true)}catch{setError('Abra a página de pagamento e copie o endereço do navegador.')}}}>{copied?'Link copiado!':'Copiar link de pagamento'}</Button></div>}{rejected&&<><p className="muted">O fornecedor recusou a geração do PIX sem criar cobrança. Corrija os dados ou a configuração antes de tentar de novo.</p><Button variant="outline" className="action" disabled={busy} onClick={()=>newOrder(true)}>Corrigir dados e criar outro pedido</Button></>}{attempted&&!rejected&&<Button variant="outline" className="action" disabled={busy} onClick={()=>newOrder()}>Iniciar outro pedido</Button>}<p className="muted">Após o pagamento, envie o comprovante ao vendedor.</p></section>{canConfigure&&provider==='beehive'&&<p><a href="/admin/beehive#clientes">Cadastrar ou corrigir cliente para PIX</a></p>}{canConfigure&&<p><a href="/admin/gateways">Gerenciar gateways de pagamento</a></p>}</main>;
}
