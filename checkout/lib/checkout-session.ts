const KEY='bravus-payment-attempt';
const LEGACY='bravus-payment-request';
export type Attempt={requestId:string;sellerName:string;amount:string;provider:string;values:Record<string,string>;paymentMethod?:'pix'|'credit_card';customerMode?:'manual'|'company';url?:string};
const attemptKey=(scope?:string)=>scope ? `${KEY}:${scope}` : KEY;
export function restoreAttempt(storage:Storage,scope?:string):{attempt?:Attempt;legacy:boolean}{
 const raw=storage.getItem(attemptKey(scope));
 if(raw){try{const a=JSON.parse(raw);if(typeof a.requestId==='string'&&typeof a.sellerName==='string'&&typeof a.amount==='string'&&typeof a.provider==='string'&&a.values&&typeof a.values==='object')return {attempt:a,legacy:false};}catch{}return {legacy:true};}
 return {legacy:!scope&&!!storage.getItem(LEGACY)};
}
export function saveAttempt(storage:Storage,attempt:Attempt,scope?:string){
 storage.setItem(attemptKey(scope),JSON.stringify(attempt));
 if(!scope)storage.removeItem(LEGACY);
}
export function clearAttempt(storage:Storage,scope?:string){
 storage.removeItem(attemptKey(scope));
 if(!scope)storage.removeItem(LEGACY);
}
