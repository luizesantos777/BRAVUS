import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const source=`import {POST} from './app/api/orders/route';import {GET} from './app/api/settings/route';import {saveCredentials} from './lib/payments';import {selectGateway,saveFallbackPolicy,activeGateway} from './lib/gateways';import {lookupCheckoutAttendant} from './lib/checkout-attendant';export default {async fetch(req){const path=new URL(req.url).pathname;if(path.startsWith('/attendant/')){try{return Response.json(await lookupCheckoutAttendant(path.split('/').at(-1)));}catch{return new Response(null,{status:503});}}if(path==='/setup'){await saveCredentials('fake-buck-token','fake-agent','buckpay');await saveCredentials('fake-fire-token','','firebot');await selectGateway('buckpay');await saveFallbackPolicy({enabled:true,autoSwitch:true,order:['buckpay','firebot'],ticketRouting:{enabled:true,rules:[{aboveCents:50000,gateway:'firebot'}]}});return Response.json({ok:true});}if(path==='/active')return Response.json({provider:await activeGateway()});return req.method==='GET'?GET(req):POST(req);}}`;
const compiled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers'],plugins:[{name:'headers',setup(b){b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function headers(){return new Headers();}',loader:'js'}));}}]});
let calls=[];
const activeAttendant=crypto.randomUUID(),redirectedAttendant=crypto.randomUUID();
const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{PAYMENT_VAULT_KEY:Buffer.alloc(32,23).toString('base64')},outboundService:async req=>{
 if(req.url.startsWith('https://bravus-omega.vercel.app/api/public/checkout-attendants/')){
  assert.equal(req.headers.get('cache-control'),'no-cache');
  if(req.url.endsWith(activeAttendant))return Response.json({name:'Atendente no Worker'});
  if(req.url.endsWith(redirectedAttendant))return Response.redirect('https://unexpected.test/');
  return new Response(null,{status:404});
 }
 calls.push(req.url);const b=await req.json();if(req.url.includes('realtechdev'))return Response.json({error:'Unauthorized'},{status:401});
 assert.equal(req.headers.get('x-api-key'),'fake-fire-token');return Response.json({success:true,amount:b.amount,transactionId:'fake-worker-tx',pixCopiaECola:'000201-worker-fallback'});
}});
try{
 const lookup=id=>mf.dispatchFetch('http://localhost/attendant/'+id);
 assert.deepEqual(await (await lookup(activeAttendant)).json(),{id:activeAttendant,name:'Atendente no Worker'});
 assert.equal(await (await lookup(crypto.randomUUID())).json(),null);
 assert.equal((await lookup(redirectedAttendant)).status,503);
 const db=await mf.getD1Database('DB');for(const migration of ['0000_bitter_king_bedlam','0001_stale_reaper','0002_complex_roulette','0003_hot_wrecker','0004_attendant-checkout'])await db.exec(readFileSync('drizzle/'+migration+'.sql','utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
 assert.equal((await mf.dispatchFetch('http://localhost/setup')).status,200);
 assert.equal((await (await mf.dispatchFetch('http://localhost/api/settings?amount=50000')).json()).provider,'buckpay');assert.equal((await (await mf.dispatchFetch('http://localhost/api/settings?amount=50001')).json()).provider,'firebot');
 const sale={amount:10000,sellerName:'Vendedor Teste',requestId:crypto.randomUUID()},send=()=>mf.dispatchFetch('http://localhost/api/orders',{method:'POST',headers:{origin:'https://pagamento.bravuspix.shop','Content-Type':'application/json'},body:JSON.stringify(sale)});
 const first=await send();assert.equal(first.status,200);const result=await first.json();assert.match(result.url,/\/pagar\//);assert.equal(calls.length,2);assert.equal((await (await mf.dispatchFetch('http://localhost/active')).json()).provider,'firebot');assert.deepEqual(await (await send()).json(),result);assert.equal(calls.length,2);
 const bio=await mf.dispatchFetch('https://biocamisas.shop/api/orders',{method:'POST',headers:{origin:'https://biocamisas.shop','Content-Type':'application/json'},body:JSON.stringify(sale)});
 assert.equal(bio.status,200);assert.equal((await bio.json()).url,result.url.replace('https://pagamento.bravuspix.shop','https://biocamisas.shop'));assert.equal(calls.length,2);
 const rows=await db.prepare('SELECT provider,state FROM payment_orders').all();assert.equal(rows.results.length,2);assert.ok(rows.results.some(r=>r.provider==='firebot'&&r.state==='ready'));assert.ok(rows.results.some(r=>r.provider==='buckpay'&&r.state==='rejected'));
 console.log('Workers/D1 gateway routing passed: encrypted credentials, exact ticket threshold, confirmed refusal, ordered fallback, atomic policy/intent updates, automatic switch and duplicate-free recovery.');
}finally{await mf.dispose();}
