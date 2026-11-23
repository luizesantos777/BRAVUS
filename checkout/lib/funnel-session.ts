export const FUNNEL_COOKIE='__Host-bravus-funnel';
export const SESSION_MS=8*60*60*1000;
export const funnelPaths=['/','/funil-2','/funil-3','/funil-4'];
export const safeReturn=(path:string)=>funnelPaths.includes(path)?path:'/';
const bytes=(s:string)=>new TextEncoder().encode(s);
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
export function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
export async function digest(password:string,salt:string){const key=await crypto.subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations:100000,hash:'SHA-256'},key,256));}
export async function sign(key:string,message:string){const k=await crypto.subtle.importKey('raw',bytes(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,bytes(message)));}
export async function validSession(cookie:string,key:string,now=Date.now()){const value=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(FUNNEL_COOKIE+'='))?.slice(FUNNEL_COOKIE.length+1)||'';const [expires,sig,...extra]=value.split('.');if(extra.length||!/^\d+$/.test(expires)||!sig||Number(expires)<=now||Number(expires)>now+SESSION_MS)return false;return equal(sig,await sign(key,expires));}
