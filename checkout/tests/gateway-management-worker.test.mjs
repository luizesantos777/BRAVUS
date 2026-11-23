import assert from 'node:assert/strict';
import {test,beforeEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// Real route handlers, encrypted vault and transactional D1; only provider HTTP is simulated.
const source=`import {GET as managementGet,POST as managementPost} from './app/api/admin/gateways/route';import {POST as order} from './app/api/orders/route';import {GET as settings} from './app/api/settings/route';import {GET as pay} from './app/api/pay/[id]/route';import {GET as adminGet,POST as adminPost} from './app/api/admin/atlas/route';import {POST as hook} from './app/api/webhooks/atlas/route';import {saveCredentials} from './lib/payments';import {selectGateway,saveFallbackPolicy,activeGateway,gateways} from './lib/gateways';import {setPanelPassword,sessionCookie} from './lib/gateway-access';export default {async fetch(req){globalThis.__fixtureHeaders=req.headers;const p=new URL(req.url).pathname;if(p==='/fixture/setup'){const b=await req.json();await saveCredentials(b.token,b.secret||'','atlas');await saveCredentials('buck-fixture-only','fixture-agent','buckpay');await selectGateway(b.provider||'atlas');if(b.policy)await saveFallbackPolicy(b.policy);const password=await setPanelPassword('fixture-admin-password');return Response.json({cookie:(await sessionCookie(password)).split(';')[0],gateways});}if(p==='/fixture/active')return Response.json({provider:await activeGateway()});if(p==='/api/settings')return settings(req);if(p==='/api/admin/gateways')return req.method==='GET'?managementGet(req):managementPost(req);if(p==='/api/admin/atlas')return req.method==='GET'?adminGet(req):adminPost(req);if(p==='/api/webhooks/atlas')return hook(req);if(p.startsWith('/api/pay/'))return pay(req,{params:Promise.resolve({id:p.split('/').pop()})});return order(req)}}`;
const compiled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers'],plugins:[{name:'fixture-headers',setup(b){b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function headers(){return globalThis.__fixtureHeaders;}',loader:'js'}));}}]});
const origin='https://pagamento.bravuspix.shop',bio='https://biocamisas.shop';
const key='atlas_sk_live_fixture_only',secret='whsec_fixture_only';
let remote=new Map(),calls=[],mode='',mutate=null,cookie='';
const list=data=>Response.json({object:'list',data,has_more:false});
const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{PAYMENT_VAULT_KEY:Buffer.alloc(32,37).toString('base64')},outboundService:async req=>{
 const url=new URL(req.url),body=req.method==='POST'?await req.json():null;
 calls.push({url:req.url,method:req.method,body,key:req.headers.get('idempotency-key'),authorization:req.headers.get('authorization')});
 if(url.hostname==='api.realtechdev.com.br')return Response.json({data:{total_amount:body.amount,pix:{code:'000201-fixture-buck',qrcode_base64:'aGVsbG8='}}},{status:201});
 assert.equal(url.origin,'https://atlaspags.com');assert.match(req.headers.get('authorization'),/^Bearer atlas_sk_(live|test)_/);
 if(mode==='auth-denied')return Response.json({detail:'Invalid API key',error:{code:'authentication_required',status:401,request_id:'req_fixture'}},{status:401});
 if(mode==='redirect')return new Response(null,{status:307,headers:{location:'https://untrusted.example'}});
 if(req.method==='GET'){
  if(mode==='bad-list')return Response.json({data:[]});
  if(mode==='read-unavailable')return Response.json({error:'Unavailable'},{status:503});
  if(url.pathname==='/api/v1/charges'){
   let items=[...remote.values()];if(url.searchParams.has('external_id'))items=items.filter(x=>x.external_id===url.searchParams.get('external_id'));
   return list(items.map(x=>mutate?{...x,...mutate}:x));
  }
  const charge=[...remote.values()].find(x=>x.id===url.pathname.split('/').pop());
  return charge?Response.json(mutate?{...charge,...mutate}:charge):Response.json({error:'Not found'},{status:404});
 }
 assert.equal(url.pathname,'/api/v1/charges');assert.equal(req.headers.get('idempotency-key'),body.external_id);assert.equal(body.method,'pix');assert.equal(typeof body.amount,'number');assert.equal(body.customer.document,'52998224725');assert.ok(!('sellerName' in body));assert.ok(!('paymentMethod' in body));assert.ok(!('cpf' in body.customer));assert.ok(!('card_token' in body));
 const charge=remote.get(body.external_id)||{id:'charge_'+remote.size,status:'pending',method:'pix',amount:body.amount,livemode:req.headers.get('authorization').includes('atlas_sk_live_'),external_id:body.external_id,fee:7.98,net_amount:body.amount-7.98,refunded:0,pix:{code:'000201-ATLAS-FIXTURE-NOT-A-REAL-PIX',qr_code_image:'https://untrusted.example/qr.svg',expires_at:'2099-01-01T00:00:00Z'}};
 remote.set(body.external_id,charge);
 if(mode==='uncertain')return Response.json({error:{code:'service_unavailable'}},{status:503});
 if(mode==='non-json')return new Response('not JSON');
 return Response.json(mutate?{...charge,...mutate}:charge);
}});
const db=await mf.getD1Database('DB');
for(const migration of ['0000_bitter_king_bedlam','0001_stale_reaper','0002_complex_roulette','0003_hot_wrecker','0004_attendant-checkout'])await db.exec(readFileSync('drizzle/'+migration+'.sql','utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' '));
const request=async(path,body,options={})=>{
 const url=(options.origin||origin)+path,headers={...(body?{'Content-Type':'application/json',Origin:options.origin||origin}:{}),...(options.admin?{Cookie:cookie}:{}),...options.headers};
 const r=await mf.dispatchFetch(url,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
};
const setup=async(extra={})=>{const result=await request('/fixture/setup',{token:key,secret,...extra});assert.equal(result.status,200);cookie=result.data.cookie;return result.data;};
const order=extra=>({requestId:crypto.randomUUID(),amount:9989,sellerName:'Vendedor privado',customer:{name:'Maria Souza',email:'maria@example.test',cpf:'529.982.247-25'},...extra});
const post=b=>request('/api/orders',b);
const posts=()=>calls.filter(x=>x.method==='POST');
const rowFor=id=>db.prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(id).first();
const age=id=>db.prepare('UPDATE payment_orders SET checked_at=0 WHERE request_id=?').bind(id).run();
const policy=extra=>({enabled:true,autoSwitch:true,order:['atlas','buckpay'],ticketRouting:{enabled:false,rules:[]},...extra});
const eventFor=(b,extra={})=>{const charge=remote.get(b.requestId);return {id:'evt_'+crypto.randomUUID(),type:'transaction.paid',livemode:charge.livemode,data:{id:charge.id,external_id:b.requestId,livemode:charge.livemode,...extra}}};
async function webhook(event,{timestamp=Math.floor(Date.now()/1000),bad=false,raw=JSON.stringify(event),headerId=event.id}={}){
 const digest=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
 const r=await mf.dispatchFetch(origin+'/api/webhooks/atlas',{method:'POST',headers:{'Content-Type':'application/json','X-Atlas-Event-Id':headerId,'X-Atlas-Signature':`t=${timestamp},v1=${bad?'0'.repeat(64):digest}`},body:raw});return {status:r.status,data:await r.json()};
}
beforeEach(async()=>{await db.exec('DELETE FROM payment_orders;DELETE FROM payment_settings;');remote=new Map();calls=[];mode='';mutate=null;await setup();});
after(async()=>{await mf.dispose();});

const management=body=>request('/api/admin/gateways',body,{admin:true});
const panel=()=>request('/api/admin/gateways',null,{admin:true});
const rate=(extra={})=>({basisPoints:599,fixedCents:199,rounding:'nearest',...extra});
const saveCost=(provider,cost=rate())=>management({action:'cost',provider,cost});
async function insertPayment(provider,amount=10000,state='paid',extra={}){const id=crypto.randomUUID(),requestId=crypto.randomUUID();await db.prepare('INSERT INTO payment_orders (id,request_id,amount,state,provider,created_at,checked_at) VALUES (?,?,?,?,?,?,?)').bind(id,requestId,amount,state,provider,extra.createdAt||Date.now(),0).run();return {id,requestId};}
const snapshot=async id=>JSON.parse((await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('gateway_cost_order:'+id).first()).value);

test('management costs/exclusion/restore require private admin, origin and bounded integer values',async()=>{
 assert.equal((await request('/api/admin/gateways')).status,403);
 for(const body of [{action:'cost',provider:'atlas',cost:rate()},{action:'exclude',provider:'atlas',replacement:'buckpay'},{action:'restore',provider:'atlas'}])assert.equal((await request('/api/admin/gateways',body)).status,403);
 assert.equal((await request('/api/admin/gateways',{action:'cost',provider:'atlas',cost:rate()},{admin:true,headers:{Origin:'https://attacker.example'}})).status,403);
 for(const patch of [{basisPoints:-1},{basisPoints:10001},{basisPoints:5.99},{fixedCents:-1},{fixedCents:300001},{fixedCents:'199'},{rounding:'bad'}])assert.equal((await saveCost('atlas',rate(patch))).status,409);
 assert.equal((await saveCost('unknown')).status,400);assert.equal(calls.length,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM payment_settings WHERE key LIKE 'gateway_cost:%'").first()).n,0);
});

test('cost is snapshotted atomically per transaction, preserves earlier tariffs and rounds each sale in cents',async()=>{
 const old=await insertPayment('buckpay',10000);
 assert.equal((await saveCost('buckpay')).status,200);
 const first=await insertPayment('buckpay',10000),second=await insertPayment('buckpay',9989);
 const firstSnapshot=await snapshot(first.id);assert.equal(firstSnapshot.rate.basisPoints,599);assert.equal(firstSnapshot.rate.fixedCents,199);
 assert.equal((await saveCost('buckpay',rate({basisPoints:1200,fixedCents:200}))).status,200);
 const third=await insertPayment('buckpay',10000);assert.equal((await snapshot(first.id)).rate.revision,firstSnapshot.rate.revision);assert.equal((await snapshot(third.id)).rate.basisPoints,1200);
 let p=await panel();assert.equal(p.status,200);const summary=p.data.costSummary.rows.find(x=>x.provider==='buckpay');assert.equal(summary.sales,4);assert.equal(summary.grossCents,39989);assert.equal(summary.costCents,798+797+1400);assert.equal(summary.unpricedSales,1);
 assert.equal((await saveCost('atlas',rate({rounding:'up'}))).status,200);await insertPayment('atlas',9989);p=await panel();assert.equal(p.data.costSummary.rows.find(x=>x.provider==='atlas').costCents,798);
 // Neither historic snapshot is recalculated from the current default rate.
 assert.equal((await snapshot(second.id)).rate.fixedCents,199);assert.equal((await db.prepare('SELECT state FROM payment_orders WHERE id=?').bind(old.id).first()).state,'paid');
});

test('missing rates remain unknown, zero is an explicit valid cost, and card costs use the Beehive profile',async()=>{
 await saveCost('atlas');const missing=await insertPayment('buckpay');assert.equal((await snapshot(missing.id)).rate,null);
 await saveCost('buckpay',rate({basisPoints:0,fixedCents:0}));const free=await insertPayment('buckpay');assert.equal((await snapshot(free.id)).rate.basisPoints,0);assert.equal((await snapshot(missing.id)).rate,null);
 await saveCost('beehive',rate({basisPoints:1500,fixedCents:199}));const card=await insertPayment('beehive_card');assert.equal((await snapshot(card.id)).provider,'beehive');const p=await panel();assert.equal(p.data.costSummary.rows.find(x=>x.provider==='beehive').costCents,1699);assert.equal(p.data.costSummary.rows.find(x=>x.provider==='buckpay').unpricedSales,1);
});

test('actual Atlas fee wins over an estimate, while test/failed/refunded charges are excluded from paid cost totals',async()=>{
 await saveCost('atlas',rate({basisPoints:1200,fixedCents:200}));const paid=await insertPayment('atlas',10000);
 await db.prepare('INSERT INTO payment_settings (key,value) VALUES (?,?)').bind('atlas_charge:'+paid.id,JSON.stringify({fee:7.32,livemode:true})).run();
 for(const state of ['test_paid','creating','ready','failed','expired','refunded','chargeback'])await insertPayment('atlas',10000,state);
 await insertPayment('atlas',10000,'paid',{createdAt:Date.now()-31*86400000});
 const p=await panel(),summary=p.data.costSummary.rows.find(x=>x.provider==='atlas');assert.equal(summary.sales,1);assert.equal(summary.actualSales,1);assert.equal(summary.costCents,732);assert.equal(summary.grossCents,10000);
});

test('excluding an inactive gateway prunes ticket/fallback, preserves its credentials/history and recovers existing PIX',async()=>{
 const b=order();await post(b);const old=await rowFor(b.requestId);
 await setup({provider:'buckpay',policy:policy({order:['buckpay','atlas'],ticketRouting:{enabled:true,rules:[{aboveCents:50000,gateway:'atlas'}]}})});
 const credential=(await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('atlas').first()).value;
 assert.equal((await management({action:'exclude',provider:'atlas'})).status,200);
 let p=await panel();assert.equal(p.data.providers.find(x=>x.id==='atlas').excluded,true);assert.equal(p.data.fallback.enabled,false);assert.deepEqual(p.data.fallback.order,['buckpay']);assert.equal(p.data.fallback.ticketRouting.enabled,false);assert.deepEqual(p.data.fallback.ticketRouting.rules,[]);
 assert.equal((await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('atlas').first()).value,credential);assert.equal((await request('/api/settings?amount=100000')).data.provider,'buckpay');
 const before=posts().length;assert.equal((await post(b)).status,200);assert.equal(posts().length,before);remote.get(b.requestId).status='paid';await age(b.requestId);const verified=await request('/api/pay/'+old.id);assert.equal(verified.data.paid,true);
 const invalidNew=await post(order({provider:'atlas'}));assert.equal(invalidNew.status,409);assert.equal(posts().length,before);
 assert.equal((await management({provider:'atlas'})).status,409);
 assert.equal((await management({fallback:policy({order:['buckpay','atlas']})})).status,400);
});

test('active exclusion requires an available replacement and restore does not reactivate or restore old routing',async()=>{
 assert.equal((await management({action:'exclude',provider:'atlas'})).status,409);
 assert.equal((await management({action:'exclude',provider:'atlas',replacement:'atlas'})).status,409);
 assert.equal((await management({action:'exclude',provider:'atlas',replacement:'eleva'})).status,409);
 assert.equal((await management({action:'exclude',provider:'atlas',replacement:'buckpay'})).status,200);
 assert.equal((await request('/fixture/active')).data.provider,'buckpay');
 assert.equal((await management({action:'restore',provider:'atlas'})).status,200);const p=await panel();assert.equal(p.data.active,'buckpay');assert.equal(p.data.providers.find(x=>x.id==='atlas').excluded,false);assert.ok(!p.data.fallback.order.includes('atlas'));
 assert.equal((await management({provider:'atlas'})).status,200);
});

test('database exclusion guard blocks a new charge even when caller bypasses routing, and is idempotent',async()=>{
 await management({action:'exclude',provider:'atlas',replacement:'buckpay'});
 await assert.rejects(()=>insertPayment('atlas',10000,'creating'),/GATEWAY_EXCLUDED/);
 assert.equal((await management({action:'exclude',provider:'atlas'})).status,200);
 assert.equal((await management({action:'restore',provider:'atlas'})).status,200);await insertPayment('atlas',10000,'creating');
 // Card charges use the same lifecycle guard as Beehive PIX.
 await management({action:'exclude',provider:'beehive'});await assert.rejects(()=>insertPayment('beehive_card',10000,'creating'),/GATEWAY_EXCLUDED/);
});

test('uncertain pre-exclusion transaction stays recoverable on the original gateway without a second POST',async()=>{
 mode='uncertain';const b=order();assert.equal((await post(b)).status,502);assert.equal(posts().length,1);
 assert.equal((await management({action:'exclude',provider:'atlas',replacement:'buckpay'})).status,200);mode='';assert.equal((await post(b)).status,200);assert.equal(posts().length,1);assert.equal((await rowFor(b.requestId)).provider,'atlas');
});

test('public endpoints never return cost profiles, provider secrets or excluded gateway inventory',async()=>{
 await saveCost('atlas');const b=order();await post(b);const row=await rowFor(b.requestId);
 const pub=JSON.stringify([(await request('/api/settings')).data,(await request('/api/pay/'+row.id)).data]);for(const word of ['basisPoints','fixedCents','costSummary',secret,key,'excluded'])assert.ok(!pub.includes(word));
 const admin=JSON.stringify((await panel()).data);assert.ok(admin.includes('basisPoints'));assert.ok(!admin.includes(key));assert.ok(!admin.includes(secret));
});

test('last gateway can be explicitly excluded, pausing new PIX/card orders until an integration is activated',async()=>{
 await db.prepare('DELETE FROM payment_settings WHERE key=?').bind('buckpay').run();
 assert.equal((await management({action:'exclude',provider:'atlas',pauseCheckout:true})).status,200);
 assert.equal((await panel()).data.paused,true);assert.equal((await request('/api/settings')).data.configured,false);assert.equal((await request('/api/settings?method=credit_card')).data.configured,false);
 assert.equal((await post(order())).status,409);assert.equal(posts().length,0);
 assert.equal((await management({action:'restore',provider:'atlas'})).status,200);assert.equal((await request('/api/settings')).data.configured,false);
 assert.equal((await management({provider:'atlas'})).status,200);assert.equal((await request('/api/settings')).data.configured,true);
});

test('concurrent exclusions cannot overwrite a newer replacement or leave that selected gateway excluded',async()=>{
 const results=await Promise.all([management({action:'exclude',provider:'atlas',replacement:'buckpay'}),management({action:'exclude',provider:'buckpay'})]);
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const p=await panel();assert.equal(p.data.providers.find(x=>x.id===p.data.active).excluded,false);assert.equal((await request('/api/settings')).data.configured,true);
});
