'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {MAX_CHECKOUT_CENTS,parseCheckoutAmount} from '@/lib/checkout-amount';
import type {FallbackPolicy} from '@/lib/gateways';
import {decimal} from './cost-editor';
export const gatewayNames:Record<string,string>={atlas:'Atlas Pags',beehive:'Beehive Pay',eleva:'Eleva Payments',gestao:'Gestão Pay',firebot:'Firebot',poseidon:'Poseidon',buckpay:'BuckPay'};
type Provider={id:string;configured:boolean;pausedUntil?:number|null};
function cents(value:string){
 const raw=value.trim();
 const parsed=/^0+(?:[,.]0{1,2})?$/.test(raw)?0:parseCheckoutAmount(raw);
 if(parsed===null||parsed>=MAX_CHECKOUT_CENTS)throw Error('Digite um limite válido em reais, por exemplo 500,00.');
 return parsed;
}
export default function RoutingControls({initial,providers,onSaved}:{initial:FallbackPolicy;providers:Provider[];onSaved:()=>Promise<void>}){
 const configured=providers.filter(p=>p.configured);
 const [enabled,setEnabled]=useState(initial.enabled),[autoSwitch,setAutoSwitch]=useState(initial.autoSwitch),[order,setOrder]=useState<string[]>(initial.order.filter(id=>configured.some(p=>p.id===id)));
 const [ticketEnabled,setTicketEnabled]=useState(initial.ticketRouting.enabled),[rules,setRules]=useState(initial.ticketRouting.rules.map(r=>({amount:decimal(r.aboveCents),gateway:r.gateway as string})));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 function move(index:number,direction:number){setOrder(current=>{const next=[...current];[next[index],next[index+direction]]=[next[index+direction],next[index]];return next;});setNotice('');}
 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setError('');setNotice('');setBusy(true);try{
  const policy={enabled,autoSwitch,order,ticketRouting:{enabled:ticketEnabled,rules:rules.map(rule=>({aboveCents:cents(rule.amount),gateway:rule.gateway}))}};
  const r=await fetch('/api/admin/gateways',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fallback:policy})}),d=await r.json();if(!r.ok)throw Error(d.error);
  setRules(d.fallback.ticketRouting.rules.map((r:{aboveCents:number;gateway:string})=>({amount:decimal(r.aboveCents),gateway:r.gateway})));
  setNotice('Regras salvas para os novos pedidos.');await onSaved();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="pay-card routing-settings" onSubmit={save}>
 <fieldset disabled={busy}><legend>Regras automáticas do PIX</legend><p className="muted">Escolha a gateway por valor e as reservas em caso de falha. Links de cartão continuam na Beehive.</p>
 <section className="routing-section"><h2>Gateway por valor de ticket</h2><label className="routing-toggle"><input type="checkbox" checked={ticketEnabled} onChange={e=>{setTicketEnabled(e.target.checked);setNotice('');}}/>Ativar regras por valor</label>
 <p className="muted">Sem regra correspondente, vale a gateway padrão. Se mais de uma regra corresponder, vale o maior limite ultrapassado.</p>
 {rules.map((rule,index)=><div className="ticket-rule" key={index}><label className="field"><span>Acima de R$</span><Input aria-label={'Limite da regra '+(index+1)} value={rule.amount} inputMode="decimal" placeholder="500,00" required onChange={e=>{setRules(current=>current.map((r,i)=>i===index?{...r,amount:e.target.value}:r));setNotice('');}}/></label><label className="field"><span>Gerar PIX em</span><select aria-label={'Gateway da regra '+(index+1)} className="method-select" value={rule.gateway} onChange={e=>{setRules(current=>current.map((r,i)=>i===index?{...r,gateway:e.target.value}:r));setNotice('');}} required><option value="">Escolha uma gateway</option>{providers.filter(p=>p.configured||p.id===rule.gateway).map(p=><option value={p.id} disabled={!p.configured} key={p.id}>{gatewayNames[p.id]}{!p.configured?' (não configurada)':''}</option>)}</select></label><Button type="button" variant="outline" aria-label={'Remover regra '+(index+1)} onClick={()=>{setRules(current=>current.filter((_,i)=>i!==index));setNotice('');}}>Remover</Button></div>)}
 <Button type="button" variant="outline" disabled={rules.length>=10||!configured.length} onClick={()=>{setRules(current=>[...current,{amount:'',gateway:configured[0]?.id||''}]);setNotice('');}}>+ Adicionar faixa de ticket</Button>
 <p className="field-note">A regra “acima de R$ 500,00” começa em R$ 500,01. Uma venda de R$ 500,00 usa a regra anterior ou a gateway padrão.</p></section>
 <section className="routing-section"><h2>Fallback e ordem das reservas</h2><label className="routing-toggle"><input type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);setNotice('');}}/>Ativar fallback entre gateways</label>
 <p className="muted">O PIX começa na gateway definida pelo ticket ou na padrão. Se houver uma recusa de autenticação confirmada, tenta as reservas na ordem abaixo, sem repetir a primeira gateway.</p>
 <ol className="fallback-order">{order.map((id,index)=><li key={id}><span><b>{index+1}.</b> {gatewayNames[id]}</span><div className="fallback-actions"><Button type="button" variant="outline" disabled={index===0} aria-label={'Subir '+gatewayNames[id]} onClick={()=>move(index,-1)}>↑</Button><Button type="button" variant="outline" disabled={index===order.length-1} aria-label={'Descer '+gatewayNames[id]} onClick={()=>move(index,1)}>↓</Button><Button type="button" variant="outline" aria-label={'Retirar '+gatewayNames[id]+' do fallback'} onClick={()=>{setOrder(current=>current.filter(item=>item!==id));setNotice('');}}>Retirar</Button></div></li>)}</ol>
 <label className="field"><span>Adicionar gateway à ordem</span><select className="method-select" value="" onChange={e=>{const id=e.target.value;if(id)setOrder(current=>[...current,id]);setNotice('');}}><option value="">Escolha uma gateway cadastrada</option>{configured.filter(p=>!order.includes(p.id)).map(p=><option key={p.id} value={p.id}>{gatewayNames[p.id]}</option>)}</select></label>
 <label className="routing-toggle"><input type="checkbox" checked={autoSwitch} onChange={e=>{setAutoSwitch(e.target.checked);setNotice('');}}/>Desviar novos pedidos automaticamente quando uma gateway falhar</label>
 <p className="field-note">Uma falha pausa essa gateway por 5 minutos para novos pedidos. Em caso de timeout ou resposta incerta, o pedido atual fica na gateway original para recuperação. Uma cobrança já gerada mantém o mesmo PIX.</p></section>
 <Button className="action" type="submit">{busy?'Salvando regras…':'Salvar regras automáticas'}</Button>
 </fieldset>{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="success">{notice}</p>}</form>;
}
