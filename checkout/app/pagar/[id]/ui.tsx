'use client';
import {useEffect,useRef,useState,useCallback} from 'react';
import {Button} from '@/components/ui/button';
import CheckoutMark from '@/components/checkout-mark';
import {BRAVUS_BRAND} from '@/lib/checkout-brand';
import type {CheckoutBrand} from '@/lib/checkout-brand';
import {maskGateway} from '@/lib/gateway-mask';
export default function Payment({id,brand=BRAVUS_BRAND}:{id:string;brand?:CheckoutBrand}){const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);const loading=useRef(false);
const load=useCallback(async(quiet=false)=>{
 if(loading.current)return;
 loading.current=true;
 if(!quiet){setBusy(true);setError('');}
 try{
  const r=await fetch('/api/pay/'+encodeURIComponent(id),{cache:'no-store'});
  const d=await r.json();if(!r.ok)throw Error(maskGateway(d.error));setData(d);
 }catch(e){if(!quiet)setError((e as Error).message);}
 finally{loading.current=false;if(!quiet)setBusy(false);}
},[id]);
useEffect(()=>{void load();},[load]);
const shouldPoll=!!data?.canVerify&&!data.paid&&!data.simulatedPaid&&!data.unavailable;
useEffect(()=>{
 if(!shouldPoll)return;
 const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load(true);},20000);
 return()=>window.clearInterval(timer);
},[load,shouldPoll]);
return <main className="pay-shell" data-checkout-brand={brand.id}><div className="pay-brand"><CheckoutMark brand={brand}/><div><strong>{brand.wordmark}</strong><small>Pagamento do seu pedido</small></div></div><section className="pay-card"><h1>{data?.simulatedPaid?'Pagamento de teste concluído':data?.paid?'Pagamento confirmado!':'Pague com PIX'}</h1>{!data&&!error&&<p>Carregando pagamento…</p>}{error&&<p className="error" role="alert">{error}</p>}{data?.testMode&&<p className="error" role="status">Ambiente de teste: nenhum dinheiro real é movimentado.</p>}{data&&<><div className="amount">{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(data.amount/100)}</div>{data.simulatedPaid?<p className="success">Simulação concluída. Este teste não confirma uma compra real.</p>:data.paid?<p className="success">Recebemos seu pagamento. Obrigado por comprar com a {brand.name}! ✅<br/><br/>Envie o comprovante ao vendedor para confirmar seu pedido.</p>:data.unavailable?<p className="error" role="alert">Este PIX está vencido ou indisponível para pagamento. Consulte o vendedor. Se já pagou, use o botão abaixo para verificar.</p>:<><p>Escaneie o QR Code ou copie o código e cole na opção PIX do seu banco.</p><img className="qr" src={data.qrUrl||('data:image/png;base64,'+data.qr)} referrerPolicy="no-referrer" alt="QR Code para pagar este pedido via PIX"/><label className="field"><span>PIX copia e cola</span><textarea className="pix-code" readOnly value={data.code} onFocus={e=>e.target.select()}/></label><Button className="action" onClick={async()=>{try{await navigator.clipboard.writeText(data.code);setCopied(true);setTimeout(()=>setCopied(false),2500)}catch{setError('Selecione e copie o código no campo acima.')}}}>{copied?'Código copiado!':'Copiar código PIX'}</Button></> }</>}{data?.canVerify&&!data.paid&&!data.simulatedPaid&&<Button className="action" disabled={busy} onClick={()=>void load()}>{busy?'Consultando…':'Já paguei — verificar pagamento'}</Button>}{error&&!data&&<Button className="action" disabled={busy} onClick={()=>void load()}>Tentar novamente</Button>}<p className="muted">Após o pagamento, envie o comprovante ao vendedor.</p></section></main>}
