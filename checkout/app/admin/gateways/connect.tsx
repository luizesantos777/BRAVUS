'use client';
import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {gatewayCatalog} from '@/lib/gateway-catalog';
import type {Gateway} from '@/lib/gateways';
import type {GatewayCost} from '@/lib/gateway-costs';
import {CostFields,decimal,readCost} from './cost-editor';
type Provider={id:string;configured:boolean;excluded:boolean;cost:GatewayCost|null};
export default function Connect({providers,initial,busy,onBusy,onComplete,onCancel}:{providers:Provider[];initial?:string;busy:boolean;onBusy:(s:string)=>void;onComplete:(notice:string)=>Promise<void>;onCancel:()=>void}){
 const firstIntegration=!providers.some(p=>p.configured&&!p.excluded);
 const initialCost=providers.find(p=>p.id===initial)?.cost;
 const [selected,setSelected]=useState(initial||''),[values,setValues]=useState<Record<string,string>>({}),[withCost,setWithCost]=useState(false),[percentage,setPercentage]=useState(initialCost?decimal(initialCost.basisPoints):''),[fixed,setFixed]=useState(initialCost?decimal(initialCost.fixedCents):''),[rounding,setRounding]=useState<string>(initialCost?.rounding||'nearest'),[useNow,setUseNow]=useState(firstIntegration),[error,setError]=useState('');
 const spec=selected?gatewayCatalog[selected as Gateway]:null,provider=providers.find(p=>p.id===selected);
 async function update(body:unknown,endpoint='/api/admin/gateways'){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível salvar a integração.');return d;}
 return <section className="pay-card gateway-connect" aria-labelledby="gateway-connect-title"><h2 id="gateway-connect-title">Adicionar ou reconectar gateway</h2><p className="muted">Escolha a plataforma, cole as credenciais e informe seu custo. As chaves são protegidas no servidor.</p><form onSubmit={async e=>{e.preventDefault();if(busy||!spec)return;setError('');let cost;try{if(withCost)cost=readCost(percentage,fixed,rounding);}catch(e){setError((e as Error).message);return;}onBusy('integration');let connected=false;try{
 const fields=Object.fromEntries(spec.fields.filter(f=>values[f.key]?.trim()).map(f=>[f.key,values[f.key].trim()]));
 await update({...fields,activate:false,...(selected==='buckpay'&&provider?.configured?{replace:true}:{})},spec.endpoint);connected=true;setValues({});
 if(provider?.excluded)await update({action:'restore',provider:selected});
 if(cost)await update({action:'cost',provider:selected,cost});
 if(useNow)await update({provider:selected});
 await onComplete(spec.name+(useNow?' integrada e ativada para novos pagamentos.':' integrada. Você pode ativá-la ou escolher as regras por ticket.'));
 }catch(e){setError((connected?'As credenciais foram salvas, mas a configuração não foi concluída. ':'')+(e as Error).message);}finally{onBusy('');}}}>
 <fieldset disabled={busy}><legend className="sr-only">Configurar integração</legend><label className="field"><span>1. Qual gateway você quer integrar?</span><select aria-label="Gateway para integrar" className="method-select" value={selected} onChange={e=>{setSelected(e.target.value);setValues({});setError('');const cost=providers.find(p=>p.id===e.target.value)?.cost;setPercentage(cost?decimal(cost.basisPoints):'');setFixed(cost?decimal(cost.fixedCents):'');setRounding(cost?.rounding||'nearest');}} required><option value="">Escolha uma plataforma</option>{Object.entries(gatewayCatalog).map(([id,s])=><option value={id} key={id}>{s.name}{providers.find(p=>p.id===id)?.excluded?' — excluída':providers.find(p=>p.id===id)?.configured?' — já cadastrada':''}</option>)}</select></label>
 {spec&&<><h3>2. Credenciais da {spec.name}</h3><p className="muted">{spec.help}</p>{spec.fields.map(f=><label className="field" key={selected+f.key}><span>{f.label}{!f.required?' (opcional)':''}</span><Input type={f.secret?'password':'text'} autoComplete={f.secret?'new-password':'off'} value={values[f.key]||''} onChange={e=>setValues({...values,[f.key]:e.target.value})} required={f.required} minLength={f.min} maxLength={f.max||1024} placeholder={f.placeholder}/></label>)}
 {provider?.configured&&<p className="field-note">Ao trocar as chaves, use credenciais da mesma conta para manter a consulta das cobranças anteriores.</p>}<h3>3. Seu custo por venda</h3><label className="routing-toggle"><input type="checkbox" checked={withCost} onChange={e=>setWithCost(e.target.checked)}/>Informar custo agora</label>{withCost&&<CostFields percentage={percentage} fixed={fixed} rounding={rounding} setPercentage={setPercentage} setFixed={setFixed} setRounding={setRounding} prefix="Integração — "/>}
 <label className="routing-toggle"><input type="checkbox" disabled={firstIntegration} checked={useNow} onChange={e=>setUseNow(e.target.checked)}/>Usar esta gateway como padrão ao concluir</label><Button className="action" type="submit">{busy?'Salvando integração…':'Salvar integração'}</Button></>}
 </fieldset>{error&&<p className="error" role="alert">{error}</p>}<Button variant="outline" className="action" type="button" disabled={busy} onClick={onCancel}>Cancelar integração</Button></form><p className="field-note">O cadastro oferece as integrações disponíveis acima. Uma plataforma diferente precisa de um conector conforme a documentação da sua API.</p></section>;
}
