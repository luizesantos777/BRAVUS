import {headers} from 'next/headers';
import {credentials,saveCredentials,guard,publicGuard,json,database} from './payments';
const KEY='gateway_panel_password';
export const COOKIE='__Host-bravus-gateway';
export async function passwordRecord(){const c=await credentials(KEY);return c?JSON.parse(c.token):null;}
const bytes=(text:string)=>new TextEncoder().encode(text);
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
async function digest(password:string,salt:string){const key=await crypto.subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations:100000,hash:'SHA-256'},key,256));}
function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
async function signature(record:any,message:string){const k=await crypto.subtle.importKey('raw',bytes(record.sessionKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,bytes(message)));}
export async function panelUnlocked(){const record=await passwordRecord();if(!record)return false;const h=await headers();const cookie=(h.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';const [expires,sig]=cookie.split('.');if(!/^\d+$/.test(expires)||!sig||Number(expires)<=Date.now()||Number(expires)>Date.now()+3600000)return false;return equal(sig,await signature(record,expires+':gateway-v2'));}
export async function panelGuard(req:Request){const deny=await publicGuard(req);if(deny)return deny;if(!await panelUnlocked())return json({error:'Digite a senha do painel para continuar.',code:'PANEL_LOCKED'},403);return null;}
// Store administration retains its existing owner requirement.
export async function ownerPanelGuard(req:Request){const deny=await guard(req);return deny||await panelGuard(req);}
export async function setPanelPassword(password:string){const record={salt:crypto.randomUUID(),sessionKey:crypto.randomUUID()+crypto.randomUUID(),hash:''};record.hash=await digest(password,record.salt);await saveCredentials(JSON.stringify(record),'',KEY);return record;}
export async function checkPassword(password:string,record:any){return equal(record.hash,await digest(password,record.salt));}
export async function sessionCookie(record:any){const expires=String(Date.now()+3600000);return COOKIE+'='+expires+'.'+await signature(record,expires+':gateway-v2')+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600';}
// Five attempts per 15-minute window; the database update is atomic across requests.
export async function claimPasswordAttempt(){const db=database(),now=Date.now();await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind('gateway_login_attempts',JSON.stringify({until:now+900000,count:0})).run();const result=await db.prepare("UPDATE payment_settings SET value=CASE WHEN json_extract(value,'$.until')<=? THEN json_object('until',?,'count',1) ELSE json_set(value,'$.count',json_extract(value,'$.count')+1) END WHERE key=? AND (json_extract(value,'$.until')<=? OR json_extract(value,'$.count')<5)").bind(now,now+900000,'gateway_login_attempts',now).run();return !!result.meta?.changes;}
