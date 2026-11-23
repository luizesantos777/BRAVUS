import assert from 'node:assert/strict';
import {test,beforeEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {BIOCAMISAS_BUYER_NAME,BRAVUS_BUYER_NAME} from '../lib/checkout-buyer-names.ts';
import {biocamisasCustomer} from '../lib/biocamisas-customer.ts';

const bioCompany=biocamisasCustomer('biocamisas',BIOCAMISAS_BUYER_NAME);

// Real route handlers, encrypted vault and transactional D1; only provider HTTP is simulated.
const source=`import {GET as diagnostics} from './app/api/admin/atlas/diagnostics/route';import {configureBeehiveCustomer} from './lib/beehive';import {POST as order} from './app/api/orders/route';import {GET as settings} from './app/api/settings/route';import {GET as pay} from './app/api/pay/[id]/route';import {GET as adminGet,POST as adminPost} from './app/api/admin/atlas/route';import {POST as hook} from './app/api/webhooks/atlas/route';import {saveCredentials} from './lib/payments';import {selectGateway,saveFallbackPolicy,activeGateway,gateways} from './lib/gateways';import {setPanelPassword,sessionCookie} from './lib/gateway-access';export default {async fetch(req){globalThis.__fixtureHeaders=req.headers;const p=new URL(req.url).pathname;if(p==='/fixture/setup'){const b=await req.json();await saveCredentials(b.token,b.secret||'','atlas');await saveCredentials('buck-fixture-only','fixture-agent','buckpay');await saveCredentials('beehive-fixture-only','pk_fixture','beehive');if(b.customer)await configureBeehiveCustomer(b.customer);await selectGateway(b.provider||'atlas');if(b.policy)await saveFallbackPolicy(b.policy);const password=await setPanelPassword('fixture-admin-password');return Response.json({cookie:(await sessionCookie(password)).split(';')[0],gateways});}if(p==='/fixture/active')return Response.json({provider:await activeGateway()});if(p==='/api/settings')return settings(req);if(p==='/api/admin/atlas/diagnostics')return diagnostics(req);if(p==='/api/admin/atlas')return req.method==='GET'?adminGet(req):adminPost(req);if(p==='/api/webhooks/atlas')return hook(req);if(p.startsWith('/api/pay/'))return pay(req,{params:Promise.resolve({id:p.split('/').pop()})});return order(req)}}`;
const compiled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers'],plugins:[{name:'fixture-headers',setup(b){b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function headers(){return globalThis.__fixtureHeaders;}',loader:'js'}));}}]});
const origin='https://pagamento.bravuspix.shop',bio='https://biocamisas.shop';
const portal='https://bravus-omega.vercel.app/api/public/checkout-attendants/';
const partnerId=crypto.randomUUID(),attendantId=crypto.randomUUID();
const key='atlas_sk_live_fixture_only',secret='whsec_fixture_only';
let remote=new Map(),calls=[],mode='',mutate=null,cookie='',portalAvailable=true,recoveryGate=null;
const list=data=>Response.json({object:'list',data,has_more:false});
const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{PAYMENT_VAULT_KEY:Buffer.alloc(32,37).toString('base64')},outboundService:async req=>{
 const url=new URL(req.url),body=req.method==='POST'?await req.json():null;
 calls.push({url:req.url,method:req.method,body,key:req.headers.get('idempotency-key'),authorization:req.headers.get('authorization')});
 if(req.url.startsWith(portal)){
  if(!portalAvailable)return new Response(null,{status:503});
  if(req.url===portal+partnerId)return Response.json({name:'Parceiro de Teste',kind:'partner'});
  if(req.url===portal+attendantId)return Response.json({name:'Atendente de Teste',kind:'attendant'});
  return new Response(null,{status:404});
 }
 if(url.hostname==='api.conta.paybeehive.com.br')return Response.json({error:'Unauthorized'},{status:401});
 if(url.hostname==='api.realtechdev.com.br')return Response.json({data:{total_amount:body.amount,pix:{code:'000201-fixture-buck',qrcode_base64:'aGVsbG8='}}},{status:201});
 assert.equal(url.origin,'https://atlaspags.com');assert.match(req.headers.get('authorization'),/^Bearer atlas_sk_(live|test)_/);
 if(req.method==='POST'&&mode.startsWith('deny-'))return Response.json({detail:mode==='deny-checkout'?'checkout_url obrigatório para esta conta':mode==='deny-email'?[{loc:['body','customer','email'],msg:'invalid',input:'private@example.test'}]:'CPF 52998224725 recusado maria@example.test atlas_sk_live_fixture_only',error:{code:mode==='deny-email'?'validation_error':'invalid_request',status:mode==='deny-email'?422:400,request_id:'req_fixture_rejection'}},{status:mode==='deny-email'?422:400,headers:{'X-Request-ID':'req_fixture_rejection'}});
 if(mode==='auth-denied')return Response.json({detail:'Invalid API key',error:{code:'authentication_required',status:401,request_id:'req_fixture'}},{status:401});
 if(mode==='redirect')return new Response(null,{status:307,headers:{location:'https://untrusted.example'}});
 if(req.method==='GET'){
  if(mode==='bad-list')return Response.json({data:[]});
  if(mode==='read-unavailable')return Response.json({error:'Unavailable'},{status:503});
  if(url.pathname==='/api/v1/charges'){
   if(recoveryGate&&url.searchParams.get('external_id')===recoveryGate.requestId){
    recoveryGate.started.resolve();
    await recoveryGate.release.promise;
   }
   let items=[...remote.values()];if(url.searchParams.has('external_id'))items=items.filter(x=>x.external_id===url.searchParams.get('external_id'));
   return list(items.map(x=>mutate?{...x,...mutate}:x));
  }
  const charge=[...remote.values()].find(x=>x.id===url.pathname.split('/').pop());
  return charge?Response.json(mutate?{...charge,...mutate}:charge):Response.json({error:'Not found'},{status:404});
 }
 assert.equal(url.pathname,'/api/v1/charges');assert.equal(req.headers.get('idempotency-key'),body.external_id);assert.equal(body.method,'pix');assert.equal(typeof body.amount,'number');assert.ok(body.customer.document===(body.customer.name===BIOCAMISAS_BUYER_NAME?bioCompany.cpf:'52998224725'));assert.ok(!('sellerName' in body));assert.ok(!('paymentMethod' in body));assert.ok(!('cpf' in body.customer));assert.ok(!('card_token' in body));
 const charge=remote.get(body.external_id)||{id:'charge_'+remote.size,status:'pending',method:'pix',amount:body.amount,livemode:req.headers.get('authorization').includes('atlas_sk_live_'),external_id:body.external_id,fee:7.98,net_amount:body.amount-7.98,refunded:0,pix:{code:'000201-ATLAS-FIXTURE-NOT-A-REAL-PIX',qr_code_image:'https://untrusted.example/qr.svg',expires_at:'2099-01-01T00:00:00Z'}};
 remote.set(body.external_id,charge);
 if(mode==='ambiguous-denial')return Response.json({detail:'CPF inválido',error:{code:'invalid_request',status:400,extra:{charge_id:charge.id}}},{status:400});
 if(mode==='timeout-after-create')return new Response(null,{status:504});
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
beforeEach(async()=>{await db.exec('DELETE FROM payment_orders;DELETE FROM payment_settings;');remote=new Map();calls=[];mode='';mutate=null;portalAvailable=true;recoveryGate=null;await setup();});
after(async()=>{await mf.dispose();});

test('Atlas admin protects credentials, verifies read-only access and preserves existing keys/default on failure',async()=>{
 assert.equal((await request('/api/admin/atlas')).status,403);
 assert.equal((await request('/api/admin/atlas',{token:key},{admin:true,headers:{Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await request('/api/admin/atlas',{token:'atlas_pk_live_public'},{admin:true})).status,400);assert.equal(calls.length,0);
 await setup({provider:'buckpay'});
 assert.equal((await request('/api/admin/atlas',{token:'Bearer '+key},{admin:true})).status,200);assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.equal((await request('/fixture/active')).data.provider,'buckpay');
 const info=await request('/api/admin/atlas',null,{admin:true});assert.deepEqual(info.data,{configured:true,webhookConfigured:true,testMode:false});assert.ok(!JSON.stringify(info).includes(key));assert.ok(!JSON.stringify(info).includes(secret));
 const encrypted=(await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('atlas').first()).value;assert.ok(!encrypted.includes(key));assert.ok(!encrypted.includes(secret));
 for(const failure of ['auth-denied','redirect','bad-list']){mode=failure;const r=await request('/api/admin/atlas',{token:'atlas_sk_live_replacement_fixture',webhookSecret:'whsec_replacement_fixture'},{admin:true});assert.ok([422,503].includes(r.status));assert.equal((await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('atlas').first()).value,encrypted);}
 assert.equal(posts().length,0);
});

test('Atlas validates buyer data, cents/reais boundaries and PIX-only method before any provider call',async()=>{
 for(const patch of [{amount:0},{amount:-1},{amount:1.5},{amount:2_147_483_648},{customer:{}},{customer:{name:'M',email:'maria@example.test',cpf:'52998224725'}},{customer:{name:'Maria Souza',email:'bad',cpf:'52998224725'}},{customer:{name:'Maria Souza',email:'maria@example.test',cpf:'11111111111'}},{paymentMethod:'credit_card'}])assert.equal((await post(order(patch))).status,400);
 assert.equal(calls.length,0);assert.equal((await db.prepare('SELECT count(*) AS n FROM payment_orders').first()).n,0);
 for(const amount of [1,300_001,2_147_483_647])assert.equal((await post(order({amount}))).status,200);
 assert.deepEqual(posts().map(x=>x.body.amount),[0.01,3000.01,21474836.47]);
});

test('Atlas creates exact documented JSON, generates local QR and recovers without duplicate POST or leaking customer data',async()=>{
 const b=order({checkoutOrigin:'https://untrusted.example'});
 const result=await request('/api/orders',b,{origin:bio,headers:{'cf-connecting-ip':'203.0.113.8'}});assert.equal(result.status,200);assert.match(result.data.url,/^https:\/\/biocamisas.shop\/pagar\//);
 assert.equal(posts()[0].body.amount,99.89);assert.equal(posts()[0].body.checkout_url,bio+'/checkout');assert.equal(posts()[0].body.customer.ip,'203.0.113.8');assert.equal(posts()[0].body.description,'Pedido Bio Camisas');
 const row=await rowFor(b.requestId);assert.equal(row.provider,'atlas');assert.match(row.qr,/^data:image\/svg\+xml;base64,/);assert.ok(!row.qr.includes('untrusted'));
 const info=await request('/api/pay/'+row.id);assert.equal(info.status,200);assert.equal(info.data.paid,false);assert.equal(info.data.canVerify,true);assert.equal(info.data.testMode,false);assert.ok(!JSON.stringify(info).includes('Maria'));assert.ok(!JSON.stringify(info).includes('Vendedor'));assert.ok(!JSON.stringify(info).includes(key));
 assert.equal((await post(b)).status,200);assert.equal(posts().length,1);assert.equal((await post({...b,amount:10000})).status,409);
 const saved=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('atlas_payload:'+row.id).first();assert.ok(!saved.value.includes('maria@example.test'));assert.ok(!saved.value.includes('203.0.113.8'));
});

test('Bio Camisas uses its server-only buyer on Atlas and keeps manual buyers and retry identity',async()=>{
 const b=order({provider:'atlas',paymentMethod:'pix',customerMode:'company',checkoutOrigin:bio,customer:{name:BIOCAMISAS_BUYER_NAME}});
 assert.equal((await post(b)).status,400);
 assert.equal((await request('/api/orders',{...b,customer:{name:'Outra empresa'}},{origin:bio})).status,400);
 assert.equal(posts().length,0);
 assert.equal(await rowFor(b.requestId),null);

 const first=await request('/api/orders',{...b,customer:{...b.customer,email:'ignored@example.test',cpf:'52998224725'}},{origin:bio});
 assert.equal(first.status,200);
 assert.match(first.data.url,/^https:\/\/biocamisas\.shop\/pagar\//);
 assert.ok(posts()[0].body.customer.email===bioCompany.email);
 assert.ok(posts()[0].body.customer.phone===bioCompany.phone);
 assert.equal((await rowFor(b.requestId)).seller_name,b.sellerName);
 assert.deepEqual(await request('/api/orders',b,{origin:bio}),first);
 assert.equal(posts().length,1);
 for(const value of [bioCompany.email,bioCompany.cpf,bioCompany.phone])assert.ok(!JSON.stringify(first.data).includes(value));

 await setup({policy:policy({order:['atlas','beehive']})});
 const withReserve={...b,requestId:crypto.randomUUID()};
 assert.equal((await request('/api/orders',withReserve,{origin:bio})).status,200);
 assert.equal((await request('/api/orders',withReserve,{origin:bio})).status,200);
 assert.equal(posts().length,2);
 const manual=await request('/api/orders',order({customerMode:'manual'}),{origin:bio});
 assert.equal(manual.status,200);
 assert.equal(posts()[2].body.customer.email,'maria@example.test');
});

test('Bravus looks up the registered buyer before charging and keeps that buyer across retries and changes',async()=>{
 const customer={name:BRAVUS_BUYER_NAME,email:'original@example.test',cpf:'52998224725',phone:'11999999999'};
 const settings=options=>request('/api/settings?requirements=1',null,options);
 const orderUsingCompany=order({customerMode:'company',customer:{name:customer.name}});
 assert.equal((await settings()).data.buyerRequirements.bravusCompanyAvailable,false);
 const missing=await post(orderUsingCompany);
 assert.equal(missing.status,400);
 assert.equal(missing.data.code,'BUYER_DETAILS_REQUIRED');
 assert.equal(await rowFor(orderUsingCompany.requestId),null);
 assert.equal(posts().length,0);

 await setup({customer});
 const publicConfig=await settings();
 assert.equal(publicConfig.data.buyerRequirements.bravusCompanyAvailable,true);
 assert.ok(!JSON.stringify(publicConfig.data).includes(customer.cpf));
 assert.ok(!JSON.stringify(publicConfig.data).includes(customer.email));
 assert.equal((await settings({origin:bio})).data.buyerRequirements.bravusCompanyAvailable,false);
 const first=await post({...orderUsingCompany,customer:{...orderUsingCompany.customer,email:'ignored@example.test'}});
 assert.equal(first.status,200);
 assert.ok(first.data.url.startsWith(origin+'/pagar/'));
 assert.equal(posts()[0].body.customer.email,customer.email);
 const snapshot=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('checkout_bravus_buyer:'+orderUsingCompany.requestId).first();
 assert.ok(!snapshot.value.includes(customer.email));

 await setup({customer,policy:policy({order:['beehive','atlas']}),provider:'beehive'});
 assert.equal((await settings()).data.buyerRequirements.bravusCompanyAvailable,true);
 const fallbackOrder={...orderUsingCompany,requestId:crypto.randomUUID()};
 const fallback=await request('/api/orders',fallbackOrder,{headers:{'cf-connecting-ip':'203.0.113.12'}});
 assert.equal(fallback.status,200);
 assert.equal(posts()[2].body.customer.email,customer.email);

 await setup({customer:{...customer,email:'updated@example.test'}});
 assert.deepEqual(await post(orderUsingCompany),first);
 assert.deepEqual(await post(fallbackOrder),fallback);
 assert.equal(posts().length,3);
 const newest=await post({...orderUsingCompany,requestId:crypto.randomUUID()});
 assert.equal(newest.status,200);
 assert.equal(posts()[3].body.customer.email,'updated@example.test');
});

test('old partner URLs use the trusted Bio Camisas profile and recover without changing origin or buyer',async()=>{
 const company={name:BIOCAMISAS_BUYER_NAME};
 const previous=order({attendantId,customerMode:'manual'});
 const previousResult=await post(previous);
 assert.equal(previousResult.status,200);
 assert.ok(previousResult.data.url.startsWith(origin+'/pagar/'));
 assert.equal((await post(order({attendantId,customerMode:'company',customer:company,checkoutOrigin:bio}))).status,400);
 const direct=order({attendantId:partnerId,customerMode:'company',customer:company});
 const created=await post(direct);
 assert.equal(created.status,200);
 assert.ok(created.data.url.startsWith(bio+'/pagar/'));
 assert.equal((await rowFor(direct.requestId)).origin,bio);
 assert.equal((await rowFor(direct.requestId)).attendant_id,partnerId);
 assert.equal((await rowFor(direct.requestId)).seller_name,'Parceiro de Teste');

 await setup({policy:policy({order:['atlas','beehive']})});
 const reserveOrder={...direct,requestId:crypto.randomUUID()};
 const withReserve=await post(reserveOrder);
 assert.equal(withReserve.status,200);
 assert.ok(withReserve.data.url.startsWith(bio+'/pagar/'));
 portalAvailable=false;
 assert.deepEqual(await post(reserveOrder),withReserve);
 assert.deepEqual(await post(direct),created);
 assert.deepEqual(await post(previous),previousResult);
 assert.equal(posts().length,3);
 assert.ok(posts()[1].body.customer.email===bioCompany.email);
});

test('Atlas recovers uncertain create by external_id with the immutable original payload and never falls back',async()=>{
 await setup({policy:policy()});mode='uncertain';const b=order();assert.equal((await post(b)).status,502);assert.equal(posts().length,1);
 mode='';const recovered=await request('/api/orders',b,{origin:bio,headers:{'cf-connecting-ip':'203.0.113.9'}});assert.equal(recovered.status,200);assert.equal(posts().length,1);assert.equal((await rowFor(b.requestId)).state,'ready');assert.ok(calls.some(x=>x.url.includes('?external_id='+b.requestId)));assert.ok(!calls.some(x=>x.url.includes('realtechdev')));
});

test('concurrent recovery after a provider timeout keeps the original charge and checkout', {timeout:10000}, async()=>{
 await setup({policy:policy()});
 mode='timeout-after-create';
 const sale=order(),result=await post(sale);
 assert.equal(result.status,502);
 assert.equal((await rowFor(sale.requestId)).state,'unconfirmed');
 assert.equal(remote.size,1);

 mode='';
 const started=Promise.withResolvers(),release=Promise.withResolvers();
 recoveryGate={requestId:sale.requestId,started,release};
 const recovery=post(sale);
 try{
  await Promise.race([started.promise,recovery.then(()=>{throw Error('Expected an authoritative charge lookup');})]);
  const concurrent=await post(sale);
  assert.equal(concurrent.status,409);
  assert.equal(concurrent.data.code,'PAYMENT_PROCESSING');
  assert.equal(posts().length,1);
 }finally{
  release.resolve();
 }

 const recovered=await recovery,row=await rowFor(sale.requestId);
 assert.equal(recovered.status,200);
 assert.equal(recovered.data.url,origin+'/pagar/'+row.id);
 assert.equal(row.transaction_id,remote.get(sale.requestId).id);
 assert.deepEqual(await post(sale),recovered);
 assert.deepEqual(calls.map(call=>call.method),['POST','GET']);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM payment_orders').first()).n,1);
});

test('Atlas retries the exact body and idempotency key only after successful empty recovery; concurrent create has one POST',async()=>{
 mode='uncertain';const b=order();assert.equal((await post(b)).status,502);const original=posts()[0];remote.clear();mode='';
 assert.equal((await request('/api/orders',b,{origin:bio,headers:{'cf-connecting-ip':'203.0.113.100'}})).status,200);
 assert.equal(posts().length,2);assert.equal(posts()[1].key,original.key);assert.deepEqual(posts()[1].body,original.body);
 const second=order();await Promise.all([post(second),post(second)]);assert.equal(posts().filter(x=>x.key===second.requestId).length,1);
});

test('Atlas credential rotation cannot duplicate an uncertain charge in another account',async()=>{
 mode='uncertain';const b=order();assert.equal((await post(b)).status,502);assert.equal(posts().length,1);
 remote.clear();mode='';await setup({token:'atlas_sk_live_replacement_fixture'});
 assert.equal((await post(b)).status,502);assert.equal(posts().length,1);assert.equal((await rowFor(b.requestId)).state,'unconfirmed');
});

test('Atlas confirmed authentication rejection permits configured fallback; malformed or uncertain responses do not',async()=>{
 await setup({policy:policy()});mode='auth-denied';const b=order();const r=await post(b);assert.equal(r.status,200);assert.equal(posts().length,2);assert.equal((await request('/fixture/active')).data.provider,'buckpay');const failed=await rowFor(b.requestId);assert.equal(failed.state,'rejected');
 await db.exec('DELETE FROM payment_orders;DELETE FROM payment_settings;');remote.clear();calls=[];await setup({policy:policy()});mode='non-json';assert.equal((await post(order())).status,502);assert.equal(posts().length,1);assert.ok(posts()[0].url.startsWith('https://atlaspags.com/'));
});

test('Atlas checks charge ID, exact amount, external ID, status and environment before recording success',async()=>{
 for(const patch of [{amount:1},{amount:'99.89'},{external_id:'another-order'},{livemode:false},{status:'unknown'},{id:'../bad'}]){mutate=patch;assert.equal((await post(order())).status,502);}
 mutate=null;const b=order();assert.equal((await post(b)).status,200);const row=await rowFor(b.requestId);remote.get(b.requestId).status='paid';
 await age(b.requestId);mutate={amount:1};assert.equal((await request('/api/pay/'+row.id)).status,503);assert.equal((await rowFor(b.requestId)).state,'ready');
 mutate=null;await age(b.requestId);const paid=await request('/api/pay/'+row.id);assert.equal(paid.data.paid,true);assert.equal(paid.data.code,null);assert.equal(paid.data.qrUrl,null);
 remote.get(b.requestId).status='refunded';await age(b.requestId);const refund=await request('/api/pay/'+row.id);assert.equal(refund.status,200);assert.equal(refund.data.paid,false);assert.equal(refund.data.unavailable,true);assert.equal(refund.data.code,null);
});

test('Atlas expiry blocks PIX and sandbox paid never becomes a real paid store order',async()=>{
 const b=order();await post(b);const row=await rowFor(b.requestId);remote.get(b.requestId).pix.expires_at='2020-01-01T00:00:00Z';await age(b.requestId);const expired=await request('/api/pay/'+row.id);assert.equal(expired.data.unavailable,true);assert.equal(expired.data.code,null);
 await setup({token:'atlas_sk_test_fixture_only'});const sandbox=order();await post(sandbox);const testRow=await rowFor(sandbox.requestId);remote.get(sandbox.requestId).status='paid';await age(sandbox.requestId);const simulated=await request('/api/pay/'+testRow.id);assert.equal(simulated.data.testMode,true);assert.equal(simulated.data.simulatedPaid,true);assert.equal(simulated.data.paid,false);assert.equal((await rowFor(sandbox.requestId)).state,'test_paid');
});

test('PIX expiration hides the cached code and QR without polling or replacing the order',async()=>{
 const sale=order(),created=await post(sale);
 assert.equal(created.status,200);
 const row=await rowFor(sale.requestId);
 const pending=await request('/api/pay/'+row.id);
 assert.equal(pending.data.unavailable,false);
 assert.match(pending.data.code,/^000201/);
 assert.match(pending.data.qrUrl,/^data:image\/svg/);

 // Move the stored expiration into the past while the status check is still fresh.
 const metadataKey='atlas_charge:'+row.id;
 const snapshot=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind(metadataKey).first();
 const expiresAt='2020-01-01T00:00:00Z';
 await db.prepare('UPDATE payment_settings SET value=? WHERE key=?').bind(JSON.stringify({...JSON.parse(snapshot.value),expiresAt}),metadataKey).run();
 await db.prepare('UPDATE payment_orders SET checked_at=? WHERE id=?').bind(Date.now(),row.id).run();

 const expired=await request('/api/pay/'+row.id);
 assert.equal(expired.status,200);
 assert.equal(expired.data.paid,false);
 assert.equal(expired.data.unavailable,true);
 assert.equal(expired.data.expiresAt,expiresAt);
 assert.equal(expired.data.code,null);
 assert.equal(expired.data.qrUrl,null);
 assert.deepEqual(await post(sale),created);
 assert.deepEqual(calls.map(call=>call.method),['POST']);
});

test('Atlas ticket routes honor exact threshold, legacy settings and maximum provider count',async()=>{
 const setupData=await setup({provider:'buckpay',policy:policy({enabled:false,ticketRouting:{enabled:true,rules:[{aboveCents:50000,gateway:'atlas'}]}})});assert.equal(setupData.gateways.length,7);
 assert.equal((await request('/api/settings?amount=50000')).data.provider,'buckpay');assert.equal((await request('/api/settings?amount=50001')).data.provider,'atlas');assert.equal((await request('/fixture/active')).data.provider,'buckpay');
 const b=order({amount:50001});assert.equal((await post(b)).status,200);assert.equal((await rowFor(b.requestId)).provider,'atlas');
});

test('Atlas signed webhook verifies authoritative charge, rejects tampering/replay, deduplicates and ignores stale event status',async()=>{
 const b=order();await post(b);const row=await rowFor(b.requestId),event=eventFor(b);
 assert.equal((await webhook(event,{bad:true})).status,401);assert.equal((await webhook(event,{timestamp:Math.floor(Date.now()/1000)-301})).status,401);assert.equal((await webhook(event,{headerId:'wrong-id'})).status,400);
 // Signed "paid" with an authoritative pending charge cannot release the order.
 assert.equal((await webhook(event)).status,200);assert.equal((await rowFor(b.requestId)).state,'ready');const before=calls.length;assert.equal((await webhook(event)).data.duplicate,true);assert.equal(calls.length,before);
 remote.get(b.requestId).status='paid';assert.equal((await webhook(eventFor(b))).status,200);assert.equal((await rowFor(b.requestId)).state,'paid');
 const delayed=eventFor(b);delayed.type='transaction.pending';assert.equal((await webhook(delayed)).status,200);assert.equal((await rowFor(b.requestId)).state,'paid');
 remote.get(b.requestId).status='chargeback';assert.equal((await webhook(eventFor(b))).status,200);assert.equal((await rowFor(b.requestId)).state,'chargeback');
});

test('Atlas webhook retries failed verification, bounds body size and acknowledges signed test events without a charge',async()=>{
 const b=order();await post(b);const event=eventFor(b);mode='read-unavailable';assert.equal((await webhook(event)).status,503);assert.equal(await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('atlas_event:'+event.id).first(),null);
 mode='';remote.get(b.requestId).status='paid';assert.equal((await webhook(event)).status,200);
 const before=calls.length;assert.equal((await webhook({id:'evt_test',type:'webhook.test'})).data.test,true);assert.equal(calls.length,before);
 assert.equal((await webhook(event,{raw:'x'.repeat(262145)})).status,413);
});

test('Atlas exposes a safe rejection cause/reference, stores private diagnostics and lets only confirmed denials start a corrected order',async()=>{
 mode='deny-document';const b=order(),r=await post(b);assert.equal(r.status,502);assert.equal(r.data.reason,'document');assert.equal(r.data.retryMode,'new_order');assert.equal(r.data.provider,'atlas');assert.equal(r.data.reference,'req_fixture_rejection');assert.match(r.data.error,/CPF\/CNPJ/);assert.equal((await rowFor(b.requestId)).state,'rejected');
 const publicText=JSON.stringify(r.data);for(const value of ['52998224725','maria@example.test',key])assert.ok(!publicText.includes(value));
 assert.equal((await request('/api/admin/atlas/diagnostics')).status,403);
 const d=await request('/api/admin/atlas/diagnostics',null,{admin:true});assert.equal(d.status,200);assert.equal(d.data.errors.length,1);assert.equal(d.data.errors[0].confirmedNoCharge,true);assert.deepEqual(d.data.errors[0].buyerFields,{name:true,email:true,document:true});
 for(const value of ['52998224725','maria@example.test',key,secret])assert.ok(!JSON.stringify(d.data).includes(value));
 const encrypted=(await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('atlas_failure:'+(await rowFor(b.requestId)).id).first()).value;assert.ok(!encrypted.includes('CPF'));assert.ok(!encrypted.includes('req_fixture_rejection'));
 const before=posts().length;assert.deepEqual((await post(b)).data,r.data);assert.equal(posts().length,before);mode='';assert.equal((await post(order())).status,200);assert.equal(posts().length,before+1);
});

test('Atlas distinguishes checkout URL and structured e-mail validation errors without exposing raw provider text',async()=>{
 mode='deny-checkout';let r=await post(order());assert.equal(r.data.reason,'checkout');assert.match(r.data.error,/endereço do checkout/);assert.equal(r.data.retryMode,'new_order');
 mode='deny-email';r=await post(order());assert.equal(r.data.reason,'email');assert.match(r.data.error,/e-mail/);assert.ok(!JSON.stringify(r).includes('private@example.test'));assert.equal(r.data.retryMode,'new_order');
});

test('an HTTP 400 with a charge identifier remains uncertain and can be recovered without authorizing another charge',async()=>{
 mode='ambiguous-denial';const b=order();let r=await post(b);assert.equal(r.status,502);assert.equal(r.data.retryMode,undefined);assert.equal((await rowFor(b.requestId)).state,'unconfirmed');assert.equal(posts().length,1);
 const d=await request('/api/admin/atlas/diagnostics',null,{admin:true});assert.equal(d.data.errors[0].confirmedNoCharge,false);
 mode='';r=await post(b);assert.equal(r.status,200);assert.equal(posts().length,1);
});

test('an explicit denial after an earlier uncertain attempt never unlocks creating a new order',async()=>{
 mode='uncertain';const b=order();assert.equal((await post(b)).status,502);remote.clear();mode='deny-document';const r=await post(b);assert.equal(r.data.retryMode,undefined);assert.equal((await rowFor(b.requestId)).state,'unconfirmed');
 const d=await request('/api/admin/atlas/diagnostics',null,{admin:true});assert.equal(d.data.errors[0].confirmedNoCharge,false);assert.equal(posts()[0].key,posts()[1].key);
});

test('Beehive name-only checkout carries its registered, encrypted buyer to the Atlas reserve and pins recovery',async()=>{
 const customer={name:'BRAVUS BRASIL LTDA',email:'maria@example.test',cpf:'52998224725',phone:'11999999999'};
 await setup({provider:'beehive',customer,policy:policy({order:['beehive','atlas']})});
 const b=order({sellerName:undefined,customer:{name:customer.name}}),r=await request('/api/orders',b,{headers:{'cf-connecting-ip':'203.0.113.12'}});assert.equal(r.status,200);
 const outbound=posts();assert.equal(outbound.length,2);assert.ok(outbound[0].url.includes('paybeehive'));assert.ok(outbound[1].url.includes('atlaspags'));assert.equal(outbound[1].body.customer.name,customer.name);assert.equal(outbound[1].body.customer.email,customer.email);assert.equal(outbound[1].body.customer.document,customer.cpf);
 const row=await db.prepare("SELECT * FROM payment_orders WHERE provider='atlas'").first();assert.ok(row.pix_code);assert.equal((await request('/api/orders',b,{headers:{'cf-connecting-ip':'203.0.113.13'}})).status,200);assert.equal(posts().length,2);
 const saved=await db.prepare('SELECT value FROM payment_settings WHERE key=?').bind('gateway_fallback_customer:'+b.requestId).first();assert.ok(saved);assert.ok(!saved.value.includes(customer.email));assert.ok(!saved.value.includes(customer.cpf));
 assert.equal((await post({...b,customer:{name:customer.name,email:'changed@example.test'}})).status,409);
});

test('Beehive requests missing details before starting a fallback order and can retry the same reference',async()=>{
 await setup({provider:'beehive',policy:policy({order:['beehive','atlas']})});
 const buyer={name:'Cliente de Teste',email:'cliente@example.test',cpf:'52998224725',phone:'11999999999'};
 const original=order({sellerName:undefined,customer:{name:buyer.name}});
 const missing=await post(original);
 assert.equal(missing.status,400);
 assert.equal(missing.data.code,'BUYER_DETAILS_REQUIRED');
 assert.equal(posts().length,0);
 assert.equal(await rowFor(original.requestId),null);
 const complete={...original,customerMode:'manual',customer:buyer};
 const options={headers:{'cf-connecting-ip':'203.0.113.12'}};
 const created=await request('/api/orders',complete,options);
 assert.equal(created.status,200);
 assert.equal(posts().length,2);
 assert.equal(posts()[1].body.customer.email,buyer.email);
 assert.equal((await request('/api/orders',complete,options)).status,200);
 assert.equal(posts().length,2);
});

test('the original Atlas rejection remains available when recovering a stopped fallback chain',async()=>{
 await setup({policy:policy()});mode='deny-document';const b=order();const first=await post(b);assert.equal(first.data.retryMode,'new_order');const before=posts().length;const again=await post(b);assert.deepEqual(again.data,first.data);assert.equal(posts().length,before);assert.ok(!posts().some(x=>x.url.includes('realtechdev')));
});

test('checkout requirements request real buyer fields for Atlas direct and reserves, keeping Beehive name lookup and cards intact',async()=>{
 let r=await request('/api/settings?requirements=1');assert.equal(r.data.buyerRequirements.fullIdentity,true);
 assert.equal(r.data.buyerRequirements.buyerDetailsRequired,true);assert.equal(r.data.buyerRequirements.phoneRequired,false);
 await setup({provider:'buckpay',policy:policy({order:['buckpay','atlas']})});r=await request('/api/settings?requirements=1');assert.equal(r.data.buyerRequirements.fullIdentity,true);
 assert.equal(r.data.buyerRequirements.buyerDetailsRequired,true);assert.equal(r.data.buyerRequirements.phoneRequired,false);
 await setup({provider:'buckpay',policy:policy({order:['buckpay','beehive']})});r=await request('/api/settings?requirements=1');assert.equal(r.data.buyerRequirements.fullIdentity,false);
 assert.equal(r.data.buyerRequirements.buyerDetailsRequired,true);assert.equal(r.data.buyerRequirements.phoneRequired,true);
 r=await request('/api/settings');assert.deepEqual(r.data,{provider:'buckpay',configured:true});
 await setup({provider:'beehive',policy:policy({order:['beehive','atlas']})});r=await request('/api/settings?requirements=1');assert.equal(r.data.buyerRequirements.fullIdentity,false);
 r=await request('/api/settings?requirements=1&method=credit_card');assert.equal(r.data.buyerRequirements.fullIdentity,false);
 assert.equal(r.data.buyerRequirements.buyerDetailsRequired,false);assert.equal(r.data.buyerRequirements.phoneRequired,false);
});
