'use client';
import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
const empty={name:'',email:'',cpf:'',phone:''};
export default function CustomerForm(){
 const [customer,setCustomer]=useState(empty),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setSaved(false);
  try{const response=await fetch('/api/admin/beehive/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer})});const result=await response.json();if(!response.ok)throw Error(result.error||'Não foi possível salvar.');setSaved(true);setCustomer(empty);}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar o cliente.');}finally{setBusy(false);}
 }
 return <section id="clientes" className="pay-card"><h2>Cadastro de cliente para PIX</h2><p>Cadastre os dados reais do comprador antes de gerar o PIX. No checkout, informe o mesmo nome completo cadastrado aqui.</p><form onSubmit={submit}><fieldset disabled={busy} className="checkout-fields"><div className="buyer-grid">{([['name','Nome completo do cliente'],['email','E-mail do cliente'],['cpf','CPF ou CNPJ do cliente'],['phone','Telefone do cliente com DDD']] as const).map(([key,label])=><label className={'field '+(key==='name'?'wide':'')} key={key}><span>{label}</span><Input value={customer[key]} onChange={e=>{setSaved(false);setCustomer({...customer,[key]:e.target.value});}} type={key==='email'?'email':key==='phone'?'tel':'text'} inputMode={key==='cpf'?'numeric':key==='phone'?'tel':undefined} autoComplete="off" required maxLength={key==='email'?254:key==='name'?150:30} placeholder={key==='phone'?'DDD + número (pode incluir +55)':undefined}/></label>)}</div><Button className="action" type="submit">{busy?'Salvando…':'Salvar cadastro do cliente'}</Button></fieldset></form>{error&&<p role="alert" className="error">{error}</p>}{saved&&<div className="success" role="status"><p>Cadastro salvo. Agora você pode gerar o PIX usando o mesmo nome do cliente.</p><a href="/checkout">Ir para o checkout</a></div>}<p className="muted">Salvar o cadastro não cria cobrança. Os dados ficam criptografados no servidor. Para corrigir um cadastro, envie os dados completos com o mesmo nome.</p></section>;
}
