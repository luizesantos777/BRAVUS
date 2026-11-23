'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {LockKeyhole,ShieldCheck,CreditCard,UserRound,Check,ArrowRight,PackageCheck,Headphones,Info,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {loadBeehive,tokenizeCard} from '@/lib/beehive-browser';
import {cardPlanLabel} from '@/lib/card-pricing';
import {maskGateway} from '@/lib/gateway-mask';
import CheckoutMark from '@/components/checkout-mark';
import {BRAVUS_BRAND} from '@/lib/checkout-brand';
import type {CheckoutBrand} from '@/lib/checkout-brand';
const emptyCard={number:'',holderName:'',expiry:'',cvv:''};
export default function CardPayment({id,brand=BRAVUS_BRAND}:{id:string;brand?:CheckoutBrand}){
 const [installments,setInstallments]=useState(1);
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[card,setCard]=useState(emptyCard),[buyer,setBuyer]=useState({name:'',email:'',cpf:''});
 const sending=useRef(false);
 const refresh=useCallback(async()=>{const r=await fetch('/api/card/'+encodeURIComponent(id),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(maskGateway(d.error));setData(d);if(d.plans?.length)setInstallments(current=>d.plans.some((plan:any)=>plan.installments===current)?current:d.plans[0].installments);return d;},[id]);
 useEffect(()=>{refresh().catch(e=>setError(e.message));},[refresh]);
 useEffect(()=>{if(!data||data.state==='card_draft'||data.paid)return;const timer=setInterval(()=>{refresh().catch(()=>{});},20000);return()=>clearInterval(timer);},[data?.state,data?.paid,refresh]);
 async function submit(e:React.FormEvent){e.preventDefault();if(sending.current||data?.state!=='card_draft')return;sending.current=true;setBusy(true);setError('');let submitted=false;
 try{
  const current=await refresh();if(current.state!=='card_draft')return;
  const quote=current.plans?.find((p:any)=>p.installments===installments);if(!quote||data.plans?.find((p:any)=>p.installments===installments)?.amount!==quote.amount)throw Error('Confira o total atualizado antes de pagar.');
  if(!current.publicKey)throw Error('O pagamento com cartão ainda não foi habilitado. Contate o vendedor.');
  const [month,year]=card.expiry.split('/').map(x=>x.trim());const expMonth=Number(month),expYear=year?.length===2?2000+Number(year):Number(year);
  const number=card.number.replace(/\D/g,'');
  if(!/^\d{13,19}$/.test(number)||!/^\d{3,4}$/.test(card.cvv)||!card.holderName.trim().includes(' ')||!Number.isInteger(expMonth)||expMonth<1||expMonth>12||!Number.isInteger(expYear)||expYear<new Date().getFullYear()||expYear>new Date().getFullYear()+30||new Date(expYear,expMonth,1).getTime()<=Date.now())throw Error('Confira o número, nome, validade e código de segurança do cartão.');
  setPhase('Autenticando cartão…');const sdk=await loadBeehive();
  const cardToken=await tokenizeCard(sdk,current.publicKey,quote.amount,{number,holderName:card.holderName.trim(),expMonth,expYear,cvv:card.cvv},installments);
  setCard(emptyCard);setPhase('Confirmando pagamento…');submitted=true;
  setData((d:any)=>({...d,plan:quote,amount:quote.amount,installments,state:'card_processing'}));
  const r=await fetch('/api/card/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardToken,customer:buyer,installments,acceptedAmount:quote.amount})});
  const result=await r.json();if(!r.ok){if(r.status===400){await refresh();throw Error(maskGateway(result.error));}setData((d:any)=>({...d,...result,state:result.state||'card_unconfirmed'}));throw Error(maskGateway(result.error)||'Consulte o resultado antes de tentar novamente.');}
  setData((d:any)=>({...d,...result}));
 }catch(e){setCard(emptyCard);setError(submitted?'Não foi possível concluir a confirmação. Consulte o pagamento antes de tentar novamente.':e instanceof Error&&e.message.startsWith('Confira')?e.message:'Não foi possível autenticar o cartão. Confira os dados e conclua a verificação do banco.');if(submitted)await refresh().catch(()=>{});}
 finally{sending.current=false;setBusy(false);setPhase('');}}
 const draft=data?.state==='card_draft',declined=['card_refused','card_canceled','card_cancelled','card_expired'].includes(data?.state),reversed=['card_refunded','card_chargedback'].includes(data?.state);
 const selectedPlan=draft?data?.plans?.find((p:any)=>p.installments===installments):data?.plan;
 const total=data?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((selectedPlan?.amount??data.amount)/100):'—';
 const chosenInstallments=data?.installments??installments;
 const formatMoney=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);

 return <div className="bravus-card-checkout" data-checkout-brand={brand.id}>
 <header className="bc-header"><div className="bc-header-inner"><a href={brand.home} className="bc-brand" aria-label={brand.name}><CheckoutMark brand={brand}/><span>{brand.wordmark}<small>{brand.tagline}</small></span></a><span className="bc-secure"><LockKeyhole size={15}/> Pagamento protegido</span></div></header>
 <main className="bc-main"><nav className="bc-progress" aria-label="Etapas do pedido"><span><i><Check size={12}/></i> Pedido</span><em/><span className="current"><i>2</i> Pagamento</span><em/><span className={data?.paid?'current':''}><i>{data?.paid?<Check size={12}/>:3}</i> Confirmação</span></nav>
 <div className="bc-heading"><span className="bc-eyebrow">{data?.paid?'COMPRA CONFIRMADA':'FALTA POUCO PARA FINALIZAR'}</span><h1>{data?.paid?'Seu pagamento foi confirmado.':'Finalize seu pedido com tranquilidade.'}</h1><p>{data?.paid?'Você pode acompanhar os próximos passos com seu vendedor.':'Confira o valor e preencha seus dados para concluir a compra.'}</p></div>
 <div className="bc-layout"><section className="bc-form-panel" aria-label="Pagamento com cartão">
 <div className="bc-panel-top"><span className="bc-icon"><CreditCard size={22}/></span><div><h2>Cartão de crédito</h2><p>Escolha pagar à vista ou parcelar em até 12 vezes.</p></div><span className="bc-selected"><Check size={16}/></span></div>
 {!data&&!error&&<p className="bc-loading" role="status">Preparando seu pagamento…</p>}
 {data?.paid?<div className="bc-state bc-state-success" role="status"><PackageCheck size={40}/><h2>Obrigado por comprar com a {brand.name}!</h2><p>Recebemos a confirmação do seu pagamento.</p><strong>{total}</strong></div>:draft?<form onSubmit={submit}>
 <fieldset disabled={busy} className="bc-fields"><div className="bc-section-title"><UserRound size={18}/><h3>Seus dados</h3></div><p className="bc-section-note">Informe os dados do comprador.</p>
 <div className="bc-input-grid bc-buyer-grid">{([['name','Nome completo','name'],['email','E-mail','email'],['cpf','CPF ou CNPJ','off']] as const).map(([key,label,auto])=><label className={'bc-field '+(key==='name'?'bc-wide':'')} key={key}><span>{label}</span><Input value={buyer[key]} onChange={e=>setBuyer({...buyer,[key]:e.target.value})} type={key==='email'?'email':'text'} inputMode={key==='cpf'?'numeric':key==='email'?'email':'text'} placeholder={key==='name'?'Nome e sobrenome':key==='email'?'voce@exemplo.com':'Somente números'} autoComplete={auto} required maxLength={key==='email'?254:150}/></label>)}</div>
 <div className="bc-divider"/><div className="bc-section-title"><CreditCard size={18}/><h3>Dados do cartão</h3><span className="bc-private"><LockKeyhole size={12}/> Criptografados</span></div>
 <div className="bc-input-grid"><label className="bc-field bc-wide"><span>Número do cartão</span><div className="bc-input-icon"><Input autoComplete="cc-number" inputMode="numeric" placeholder="0000 0000 0000 0000" value={card.number} onChange={e=>setCard({...card,number:e.target.value.replace(/\D/g,'').slice(0,19).replace(/(.{4})/g,'$1 ').trim()})} required maxLength={23}/><CreditCard size={20}/></div></label>
 <label className="bc-field bc-wide"><span>Nome impresso no cartão</span><Input autoComplete="cc-name" placeholder="Como aparece no cartão" value={card.holderName} onChange={e=>setCard({...card,holderName:e.target.value})} required maxLength={150}/></label>
 <label className="bc-field"><span>Validade</span><Input autoComplete="cc-exp" inputMode="numeric" placeholder="MM/AA" value={card.expiry} onChange={e=>{const v=e.target.value.replace(/\D/g,'').slice(0,4);setCard({...card,expiry:v.length>2?v.slice(0,2)+'/'+v.slice(2):v})}} required maxLength={5}/></label>
 <label className="bc-field"><span>Código de segurança <small>CVV</small></span><Input type="password" autoComplete="cc-csc" inputMode="numeric" placeholder="3 ou 4 dígitos" value={card.cvv} onChange={e=>setCard({...card,cvv:e.target.value.replace(/\D/g,'').slice(0,4)})} required minLength={3} maxLength={4}/><small className="bc-help">Encontre no verso ou na frente do cartão.</small></label></div>
 <label className="bc-field bc-installments"><span>Em quantas vezes deseja pagar?</span><select className="method-select" value={installments} onChange={e=>setInstallments(Number(e.target.value))}>{data.plans?.map((p:any)=><option key={p.installments} value={p.installments}>{p.installments}x — total {formatMoney(p.amount)}</option>)}</select>{selectedPlan&&<strong className="bc-installment-detail" aria-live="polite">{cardPlanLabel(selectedPlan)}</strong>}<small className="bc-help">Total com a taxa de parcelamento: {total}. Os valores indicados somam exatamente esse total. Sujeito à aprovação do cartão.</small></label><div className="bc-payment-line"><span>Forma de pagamento</span><strong>{installments}x no cartão</strong></div></fieldset>
 <div className="bc-submit-area"><Button className="bc-pay-button" disabled={busy||!data.publicKey||!selectedPlan}>{busy?<>{phase||'Preparando pagamento…'}</>:<><LockKeyhole size={17}/><span>Pagar {total}</span><ArrowRight size={18}/></>}</Button>{data.amountError&&<p className="bc-error" role="alert">{data.amountError}</p>}{!data.publicKey&&<p className="bc-error">O pagamento com cartão ainda não foi habilitado. Contate o vendedor.</p>}<p className="bc-submit-note">Seu banco poderá pedir uma confirmação de segurança.<br/>Aguarde o resultado após clicar em pagar.</p></div>
 </form>:data&&<div role="status" className={'bc-state '+(declined?'bc-state-declined':'')}><Info size={30}/><h2>{declined?'Pagamento não aprovado':reversed?'Pagamento atualizado':'Estamos consultando seu pagamento'}</h2><p>{declined?'Fale com o vendedor antes de iniciar outro pedido.':reversed?'Este pagamento foi estornado ou contestado. Fale com o vendedor.':'Aguarde a confirmação. Consulte o resultado antes de tentar outra cobrança.'}</p></div>}
 {error&&<p className="bc-error" role="alert">{error}</p>}{!data?.paid&&(!draft||error||data?.amountError)&&<button className="bc-refresh" type="button" disabled={busy} onClick={()=>{setError('');refresh().catch(e=>setError(e.message));}}><RefreshCw size={15}/> Consultar pagamento</button>}
 <div className="bc-panel-bottom"><LockKeyhole size={14}/><span>Os dados do cartão são protegidos antes de serem enviados para pagamento.</span></div></section>
 <aside className="bc-sidebar"><section className="bc-summary"><span className="bc-eyebrow">SUA COMPRA</span><h2>Resumo do pedido</h2><div className="bc-order-item"><div className="bc-order-icon"><PackageCheck size={24}/></div><div><strong>Pedido {brand.name}</strong><p>Valor combinado com seu vendedor</p></div></div><div className="bc-summary-row"><span>Pagamento</span><strong>Cartão de crédito</strong></div><div className="bc-summary-row"><span>Valor do pedido</span><strong>{formatMoney(data?.baseAmount??data?.amount??0)}</strong></div><div className="bc-summary-row"><span>Taxa ({((selectedPlan?.rateBps??0)/100).toLocaleString('pt-BR')}%)</span><strong>{formatMoney(selectedPlan?.feeAmount??0)}</strong></div><div className="bc-summary-row"><span>Parcelas</span><strong>{selectedPlan?cardPlanLabel(selectedPlan):chosenInstallments+'x no cartão'}</strong></div><div className="bc-summary-total"><span>Total a pagar</span><strong>{total}</strong><small>Confira o valor antes de confirmar.</small></div><div className="bc-summary-brand"><CheckoutMark brand={brand}/><span>Você está comprando com<br/><strong>{brand.name}</strong></span></div></section>
 <section className="bc-confidence" aria-label="Sobre seu pagamento"><div><ShieldCheck size={22}/><p><strong>Dados do cartão protegidos</strong><span>O número e o código de segurança não são armazenados pela {brand.name}.</span></p></div><div><Check size={22}/><p><strong>Confirmação na mesma página</strong><span>Acompanhe aqui o resultado do seu pagamento.</span></p></div><div><Headphones size={22}/><p><strong>Precisa de ajuda?</strong><span>Fale com o vendedor que enviou este link antes de concluir a compra.</span></p></div></section>
 </aside></div><footer className="bc-footer"><span>{brand.wordmark}</span><span><LockKeyhole size={12}/> Conexão criptografada</span></footer></main></div>;
}
