import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { BIOCAMISAS_ORIGINS, BRAVUS_PAYMENT_ORIGIN } from './checkout-brand';
export const BUCKPAY_USER_AGENT='Buckpay API';
export const SITE_ORIGIN='https://bravus-atendimento-v2.luizlucrocerto.chatgpt.site';
export const PAYMENT_ORIGIN=BRAVUS_PAYMENT_ORIGIN;
const ALLOWED_ORIGINS=[SITE_ORIGIN,PAYMENT_ORIGIN,...BIOCAMISAS_ORIGINS];
const runtime=()=>env as unknown as Record<string,any>;
export const database=()=>{const db=runtime().DB;if(!db)throw new Error('Database unavailable');return db;};
export async function isOwner(){const h=await headers();return !!h.get('oai-authenticated-user-id') && h.get('oai-authenticated-user-email')?.toLowerCase()===String(runtime().ADMIN_EMAIL||'').toLowerCase() && !!runtime().ADMIN_EMAIL;}
export const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const originAllowed=(req:Request)=>ALLOWED_ORIGINS.includes(req.headers.get('origin')||'');
export async function guard(req:Request){if(!await isOwner())return json({error:'Acesso restrito ao responsável pela loja.'},403);if(req.method!=='GET' && !originAllowed(req))return json({error:'Origem inválida.'},403);return null;}
export async function publicGuard(req:Request){if(req.method!=='GET' && !originAllowed(req))return json({error:'Origem inválida.'},403);return null;}
export async function readBody(req:Request){const raw=await req.text();if(raw.length>4096)throw new Error('Invalid input');return JSON.parse(raw);}
async function vaultKey(){const key=runtime().PAYMENT_VAULT_KEY;if(!key)throw new Error('Vault unavailable');return crypto.subtle.importKey('raw',Uint8Array.from(atob(key),(c)=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function saveCredentials(token:string,agent:string,provider="buckpay",replace=true){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},await vaultKey(),new TextEncoder().encode(JSON.stringify({token,agent})));
 const value=JSON.stringify({iv:Array.from(iv),data:Array.from(new Uint8Array(bytes))});
 const conflict=replace?'UPDATE SET value=excluded.value':'NOTHING';
 await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO '+conflict).bind(provider,value).run();
}
export async function credentials(provider="buckpay"){const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind(provider).first();if(!row)return null;const x=JSON.parse(row.value);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(x.iv)},await vaultKey(),new Uint8Array(x.data))));}
export async function buck(path:string,init:RequestInit={}){const c=await credentials();if(!c)throw new Error('Not configured');return fetch('https://api.realtechdev.com.br'+path,{...init,headers:{Authorization:'Bearer '+c.token,'User-Agent':c.agent||BUCKPAY_USER_AGENT,'Content-Type':'application/json',Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});}
export const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
