import assert from 'node:assert/strict';
import {test,beforeEach,after} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const db=new DatabaseSync(':memory:');
for(const migration of ['0000_bitter_king_bedlam','0001_stale_reaper','0002_complex_roulette','0003_hot_wrecker','0004_attendant-checkout'])db.exec(readFileSync('drizzle/'+migration+'.sql','utf8'));
globalThis.__env={ADMIN_EMAIL:'owner@example.test',PAYMENT_VAULT_KEY:Buffer.alloc(32,23).toString('base64'),ELEVA_DEFAULT_PAYER_NAME:'Cliente Teste',ELEVA_DEFAULT_PAYER_CPF:'52998224725',DB:{prepare(sql){const execute=(args=[])=>({async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}});return {...execute(),bind(...args){return execute(args)}}}}};
globalThis.__headers=new Headers();
const temp=mkdtempSync(join(tmpdir(),'bravus-routing-'));
const plugin={name:'runtime',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},x=>({path:x.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:x.path==='cloudflare:workers'?'export const env=globalThis.__env':'export async function headers(){return globalThis.__headers}',loader:'js'}));}};
async function load(entry,name){const out=join(temp,name+'.mjs');await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[plugin]});return import(pathToFileURL(out).href);}
const orders=await load('app/api/orders/route.ts','orders'),settings=await load('app/api/settings/route.ts','settings'),admin=await load('app/api/admin/gateways/route.ts','admin'),gates=await load('lib/gateways.ts','gates'),vault=await load('lib/payments.ts','vault'),access=await load('lib/gateway-access.ts','access'),shop=await load('app/api/store/orders/route.ts','shop'),shopAdmin=await load('app/api/store/admin/route.ts','shop-admin'),bee=await load('lib/beehive.ts','bee');
const origin='https://pagamento.bravuspix.shop';
const req=(body,source=origin)=>new Request(origin+'/api/orders',{method:'POST',headers:{origin:source,'Content-Type':'application/json'},body:JSON.stringify(body)});
const get=(amount,method='')=>settings.GET(new Request(origin+'/api/settings'+(amount===undefined?'':'?amount='+amount)+(method?(amount===undefined?'?':'&')+'method='+method:'')));
const body=(extra={})=>({amount:10000,requestId:crypto.randomUUID(),sellerName:'Vendedor de Teste',...extra});
const policy=(extra={})=>({enabled:true,autoSwitch:true,order:['buckpay','firebot'],ticketRouting:{enabled:false,rules:[]},...extra});
const buckGood=amount=>Response.json({data:{total_amount:amount,pix:{code:'000201-test-routing',qrcode_base64:'aGVsbG8='}}},{status:201});
const fireGood=amount=>Response.json({success:true,amount,transactionId:'test-firebot-tx',pixCopiaECola:'000201-test-routing'},{status:201});
const denied=()=>Response.json({error:'Invalid API credential'},{status:401});
const rows=()=>db.prepare('SELECT * FROM payment_orders ORDER BY created_at').all();
const chain=id=>JSON.parse(db.prepare('SELECT value FROM payment_settings WHERE key=?').get('gateway_fallback_order:'+id).value);
const choose=async (id='buckpay')=>gates.selectGateway(id);
let calls=[];
beforeEach(async()=>{
 db.exec('DELETE FROM payment_orders;DELETE FROM payment_settings');
 for(const id of gates.gateways)await vault.saveCredentials('test-private-'+id,'test-agent',id);
 const password=await access.setPanelPassword('local-test-password');globalThis.__headers=new Headers({cookie:(await access.sessionCookie(password)).split(';')[0]});
 await choose();calls=[];
 globalThis.fetch=async(url,init={})=>{const payload=init.body?JSON.parse(init.body):{};calls.push({url,method:init.method||'GET',payload});return url.includes('realtechdev')?buckGood(payload.amount):fireGood(payload.amount);};
});
after(()=>{db.close();rmSync(temp,{recursive:true,force:true});});

test('protected policy, CSRF, disabled defaults, validation and private metadata',async()=>{
 assert.equal((await gates.fallbackPolicy()).enabled,false);
 const cookie=globalThis.__headers;globalThis.__headers=new Headers();assert.equal((await admin.GET(new Request(origin))).status,403);assert.equal((await admin.POST(req({fallback:policy()}))).status,403);globalThis.__headers=cookie;
 assert.equal((await admin.POST(req({fallback:policy()},'https://attacker.test'))).status,403);
 for(const invalid of [policy({order:['buckpay','buckpay']}),policy({order:['unknown','buckpay']}),policy({order:['firebot']}),policy({autoSwitch:'true'}),policy({ticketRouting:{enabled:true,rules:[]}}),policy({ticketRouting:{enabled:true,rules:[{aboveCents:2147483647,gateway:'firebot'}]}}),policy({ticketRouting:{enabled:true,rules:[{aboveCents:0.1,gateway:'firebot'}]}}),policy({ticketRouting:{enabled:true,rules:[{aboveCents:50000,gateway:'firebot'},{aboveCents:50000,gateway:'buckpay'}]}})])assert.equal((await admin.POST(req({fallback:invalid}))).status,400);
 db.prepare('DELETE FROM payment_settings WHERE key=?').run('firebot');assert.equal((await admin.POST(req({fallback:policy()}))).status,400);
 assert.equal((await admin.POST(req({fallback:policy({enabled:false})}))).status,200);
 const data=await (await admin.GET(new Request(origin))).json();assert.ok(!JSON.stringify(data).includes('test-private-'));assert.equal(data.fallback.enabled,false);assert.equal(calls.length,0);
 for(const amount of ['0','2147483648','1e4','6.00','NaN'])assert.equal((await get(amount)).status,400);
 assert.deepEqual(await (await get(10000)).json(),{configured:true,provider:'buckpay'});
});

test('PIX preflight and creation use the routed account limits, preserving existing payments',async()=>{
 const rule=policy({enabled:false,ticketRouting:{enabled:true,rules:[{aboveCents:150000,gateway:'firebot'}]}});
 await gates.saveFallbackPolicy(rule);
 const check=amount=>settings.GET(new Request(origin+'/api/settings?requirements=1&method=pix&amount='+amount));
 const amountLimits=(provider,minCents,maxCents)=>admin.POST(req({action:'amount-limits',provider,amountLimits:{pix:{minCents,maxCents},credit_card:null}}));
 assert.equal((await (await check(350001)).json()).amountCheck.status,'without_limits');
 assert.equal(calls.length,0);
 const existing=body({amount:350001,provider:'firebot'});
 assert.equal((await orders.POST(req(existing))).status,200);
 assert.equal((await amountLimits('firebot',200000,300000)).status,200);
 assert.equal((await amountLimits('buckpay',1000,50000)).status,200);
 assert.equal((await amountLimits('buckpay',50000,1000)).status,409);
 assert.equal((await (await check(50000)).json()).amountCheck.status,'within_limits');
 for(const amount of [999,70000,150001,350001]){
  const preflight=await check(amount);
  assert.equal(preflight.status,400);assert.equal((await preflight.json()).code,'AMOUNT_LIMIT');
  const submit=await orders.POST(req(body({amount})));
  assert.equal(submit.status,400);assert.equal((await submit.json()).code,'AMOUNT_LIMIT');
 }
 assert.equal((await orders.POST(req(existing))).status,200);
 assert.equal(calls.length,1);
 await vault.saveCredentials('another-firebot-token','','firebot');
 assert.equal((await (await check(350001)).json()).amountCheck.status,'without_limits');
});

test('a PIX reserve cannot send a charge outside its registered range',async()=>{
 await gates.saveFallbackPolicy(policy({autoSwitch:false}));
 assert.equal((await admin.POST(req({action:'amount-limits',provider:'firebot',amountLimits:{pix:{minCents:null,maxCents:5000},credit_card:null}}))).status,200);
 globalThis.fetch=async url=>{calls.push(url);return denied();};
 const sale=body();
 assert.equal((await orders.POST(req(sale))).status,503);
 assert.equal(calls.length,1);
 assert.ok(calls[0].includes('realtechdev'));
 assert.deepEqual(chain(sale.requestId).attempts.map(a=>a.outcome),['rejected','skipped']);
});

test('ticket routing works independently; strict boundaries, sorted rules and unchanged default',async()=>{
 await gates.saveFallbackPolicy(policy({enabled:false,ticketRouting:{enabled:true,rules:[{aboveCents:100000,gateway:'gestao'},{aboveCents:50000,gateway:'firebot'}]}}));
 for(const [amount,provider] of [[600,'buckpay'],[50000,'buckpay'],[50001,'firebot'],[100000,'firebot'],[100001,'gestao'],[300000,'gestao']])assert.equal((await (await get(amount)).json()).provider,provider);
 assert.equal((await gates.fallbackPolicy()).ticketRouting.rules[0].aboveCents,50000);
 const sale=body({amount:50001,provider:'buckpay'});assert.equal((await orders.POST(req(sale))).status,409);assert.equal(calls.length,0);
 const response=await orders.POST(req({...sale,provider:'firebot'}));assert.equal(response.status,200);assert.equal(rows()[0].provider,'firebot');assert.equal(await gates.activeGateway(),'buckpay');
 assert.equal((await orders.POST(req({...sale,provider:'firebot'}))).status,200);assert.equal(calls.length,1);
});

test('confirmed authentication refusal falls back in configured order and pins recovery',async()=>{
 await gates.saveFallbackPolicy(policy());globalThis.fetch=async(url,init)=>{const p=JSON.parse(init.body);calls.push(url);return url.includes('realtechdev')?denied():fireGood(p.amount);};
 const sale=body(),r=await orders.POST(req(sale));assert.equal(r.status,200);const result=await r.json();assert.equal(calls.length,2);assert.equal(await gates.activeGateway(),'firebot');
 assert.deepEqual(chain(sale.requestId).attempts.map(a=>a.provider),['buckpay','firebot']);assert.equal(chain(sale.requestId).attempts[0].requestId,sale.requestId);
 assert.deepEqual(await (await orders.POST(req(sale))).json(),result);assert.equal(calls.length,2);
 for(const change of [{amount:10001},{sellerName:'Outro Vendedor'},{customer:{name:'Changed'}}])assert.equal((await orders.POST(req({...sale,...change}))).status,409);
 assert.ok(!JSON.stringify(chain(sale.requestId)).includes('Vendedor de Teste'));assert.ok(!JSON.stringify(chain(sale.requestId)).includes('test-private-'));
 await gates.saveFallbackPolicy(policy({enabled:false}));assert.deepEqual(await (await orders.POST(req(sale))).json(),result);assert.equal(calls.length,2);
});

test('individual checkout pins the attendant to every gateway attempt and recovers the same payment',async()=>{
 await gates.saveFallbackPolicy(policy({autoSwitch:false}));
 const attendantId=crypto.randomUUID(),otherId=crypto.randomUUID();
 const endpoint='https://bravus-omega.vercel.app/api/public/checkout-attendants/';
 let lookups=0;
 globalThis.fetch=async(url,init)=>{
  if(url.startsWith(endpoint)){
   lookups++;
   return url===endpoint+attendantId?Response.json({name:'Atendente de Teste'}):new Response(null,{status:404});
  }
  calls.push(url);
  return url.includes('realtechdev')?denied():fireGood(JSON.parse(init.body).amount);
 };
 assert.equal((await orders.POST(req(body({attendantId:'invalid'})))).status,400);
 assert.equal((await orders.POST(req(body({attendantId:otherId})))).status,404);
 assert.deepEqual(calls,[]);
 const sale=body({attendantId,sellerName:'Nome enviado pelo cliente'});
 const response=await orders.POST(req(sale));assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(calls.length,2);
 assert.deepEqual(rows().map(row=>[row.attendant_id,row.seller_name]),[[attendantId,'Atendente de Teste'],[attendantId,'Atendente de Teste']]);
 assert.deepEqual(await (await orders.POST(req(sale))).json(),result);
 assert.equal((await orders.POST(req({...sale,attendantId:otherId}))).status,409);
 assert.equal((await orders.POST(req({...sale,attendantId:undefined}))).status,409);
 assert.equal(lookups,2);assert.equal(calls.length,2);
});

for(const [name,failure] of [
 ['network timeout',()=>{throw Error('synthetic timeout');}],
 ['HTTP 500',()=>Response.json({error:'Service unavailable'},{status:500})],
 ['invalid JSON',()=>new Response('<html>wrong</html>')],
 ['missing PIX',()=>Response.json({data:{total_amount:10000}})],
 ['401 with a transaction',()=>Response.json({error:'Unauthorized',data:{id:'possibly-created-charge'}},{status:401})],
 ['403 with non-JSON body',()=>new Response('Forbidden',{status:403})]
])test(name+' never retries this order on another gateway; future orders can switch',async()=>{
 await gates.saveFallbackPolicy(policy());globalThis.fetch=async(url,init)=>{calls.push({url,method:init.method});return failure();};
 const sale=body(),r=await orders.POST(req(sale));assert.equal(r.status,502);assert.equal((await r.json()).code,'PAYMENT_UNCONFIRMED');assert.equal(calls.length,1);assert.equal(rows().length,1);assert.equal(rows()[0].provider,'buckpay');assert.equal(await gates.activeGateway(),'firebot');
 globalThis.fetch=async(url,init={})=>{calls.push({url,method:init.method||'GET'});assert.ok(!init.method||init.method==='GET');assert.ok(url.includes('realtechdev'));return Response.json({error:'Not found'},{status:404});};
 assert.equal((await orders.POST(req(sale))).status,409);assert.equal(rows().length,1);assert.equal(calls.length,2);
});

test('fallback reserves are ordered and incompatible buyer requirements are skipped',async()=>{
 await gates.saveFallbackPolicy(policy({order:['buckpay','poseidon','firebot']}));
 globalThis.fetch=async(url,init)=>{calls.push(url);return url.includes('realtechdev')?denied():fireGood(JSON.parse(init.body).amount);};
 const sale=body();assert.equal((await orders.POST(req(sale))).status,200);assert.equal(calls.length,2);assert.ok(!calls.some(url=>url.includes('poseidon')));assert.deepEqual(chain(sale.requestId).attempts.map(a=>a.outcome),['rejected','skipped','ready']);
});

test('primary invalid buyer input creates no claim and can be corrected with the same ID',async()=>{
 await choose('firebot');await gates.saveFallbackPolicy(policy());const sale=body({customer:{name:'Invalid'}});
 assert.equal((await orders.POST(req(sale))).status,400);assert.equal(rows().length,0);assert.equal(calls.length,0);assert.equal(db.prepare('SELECT count(*) AS n FROM payment_settings WHERE key LIKE ?').get('gateway_fallback_order:%').n,0);
 assert.equal((await orders.POST(req({...sale,customer:{}}))).status,200);assert.equal(calls.length,1);
});

test('concurrent requests share one chain and one POST per attempted gateway',async()=>{
 await gates.saveFallbackPolicy(policy());let release,started;const wait=new Promise(r=>release=r),start=new Promise(r=>started=r);
 globalThis.fetch=async(url,init)=>{calls.push(url);if(url.includes('realtechdev')){started();await wait;return denied();}return fireGood(JSON.parse(init.body).amount);};
 const sale=body(),first=orders.POST(req(sale));await start;const second=await orders.POST(req(sale));assert.equal(second.status,409);assert.equal(calls.length,1);release();assert.equal((await first).status,200);assert.equal(calls.length,2);assert.equal(rows().length,2);
});

test('manual re-selection during an outbound request is not overwritten by automation',async()=>{
 await gates.saveFallbackPolicy(policy());globalThis.fetch=async(url,init)=>{calls.push(url);if(url.includes('realtechdev')){await choose('buckpay');return denied();}return fireGood(JSON.parse(init.body).amount);};
 assert.equal((await orders.POST(req(body()))).status,200);assert.equal(await gates.activeGateway(),'buckpay');assert.equal((await (await get(10000)).json()).provider,'buckpay');
});

test('disabling fallback during the first attempt stops additional gateways',async()=>{
 await gates.saveFallbackPolicy(policy());globalThis.fetch=async()=>{calls.push('first');await gates.saveFallbackPolicy(policy({enabled:false}));return denied();};
 const sale=body();assert.equal((await orders.POST(req(sale))).status,503);assert.equal(calls.length,1);assert.equal((await orders.POST(req(sale))).status,503);assert.equal(calls.length,1);
});

test('auto-switch can be disabled, then cooldown expires or manual selection resets it',async()=>{
 await gates.saveFallbackPolicy(policy({autoSwitch:false}));globalThis.fetch=async(url,init)=>{calls.push(url);return url.includes('realtechdev')?denied():fireGood(JSON.parse(init.body).amount);};
 assert.equal((await orders.POST(req(body()))).status,200);assert.equal(await gates.activeGateway(),'buckpay');assert.equal((await (await get(10000)).json()).provider,'buckpay');
 await gates.saveFallbackPolicy(policy());assert.equal((await (await get(10000)).json()).provider,'firebot');
 const health=await gates.gatewayHealth('buckpay');db.prepare('UPDATE payment_settings SET value=? WHERE key=?').run(JSON.stringify({...health,failedUntil:Date.now()-1}),'gateway_health:buckpay');assert.equal((await (await get(10000)).json()).provider,'buckpay');
 await gates.markGatewayFailure('buckpay','unconfirmed',(await gates.gatewaySelection()).epoch);assert.equal((await (await get(10000)).json()).provider,'firebot');await choose();assert.equal((await (await get(10000)).json()).provider,'buckpay');
});

test('ticket-specific failure preserves the default and routes future tickets to reserves',async()=>{
 await gates.saveFallbackPolicy(policy({order:['firebot','buckpay'],ticketRouting:{enabled:true,rules:[{aboveCents:50000,gateway:'firebot'}]}}));
 globalThis.fetch=async(url,init)=>{calls.push(url);return url.includes('realtechdev')?buckGood(JSON.parse(init.body).amount):denied();};
 assert.equal((await orders.POST(req(body({amount:50001})))).status,200);assert.equal(await gates.activeGateway(),'buckpay');assert.equal((await (await get(50000)).json()).provider,'buckpay');assert.equal((await (await get(50001)).json()).provider,'buckpay');assert.equal((await gates.lastGatewaySwitch()).scope,'ticket');
});

test('existing direct PIX stays on its original provider after enabling routing',async()=>{
 const sale=body();assert.equal((await orders.POST(req(sale))).status,200);await choose('firebot');await gates.saveFallbackPolicy(policy({ticketRouting:{enabled:true,rules:[{aboveCents:0,gateway:'firebot'}]}}));
 assert.equal((await orders.POST(req(sale))).status,200);assert.equal(calls.length,1);assert.equal(rows()[0].provider,'buckpay');
});

test('completed or cancelled PIX and expired orchestration leases never create new charges',async()=>{
 await gates.saveFallbackPolicy(policy());const sale=body();const r=await orders.POST(req(sale)),result=await r.json();assert.equal(r.status,200);
 db.prepare('UPDATE payment_orders SET state=?').run('cancelled');assert.deepEqual(await (await orders.POST(req(sale))).json(),result);assert.equal(calls.length,1);
 const record=chain(sale.requestId);record.state='running';record.leaseUntil=Date.now()-1;db.prepare('UPDATE payment_orders SET state=?').run('ready');db.prepare('UPDATE payment_settings SET value=? WHERE key=?').run(JSON.stringify(record),'gateway_fallback_order:'+sale.requestId);
 assert.deepEqual(await (await orders.POST(req(sale))).json(),result);assert.equal(calls.length,1);
});

test('card links stay with Beehive and do not enter PIX fallback or ticket rules',async()=>{
 await choose('beehive');await gates.saveFallbackPolicy(policy({order:['beehive','buckpay'],ticketRouting:{enabled:true,rules:[{aboveCents:0,gateway:'firebot'}]}}));
 assert.equal((await (await get(10000)).json()).provider,'firebot');assert.equal((await (await get(undefined,'credit_card')).json()).provider,'beehive');
 const sale=body({provider:'beehive',paymentMethod:'credit_card'}),r=await orders.POST(req(sale));assert.equal(r.status,200);assert.match((await r.json()).url,/\/cartao\//);assert.equal(calls.length,0);assert.equal(rows()[0].provider,'beehive_card');assert.equal(db.prepare('SELECT count(*) AS n FROM payment_settings WHERE key LIKE ?').get('gateway_fallback_order:%').n,0);
});

test('Eleva 408 then 401 and ambiguous recovery 401 do not authorize another gateway',async()=>{
 await choose('eleva');await gates.saveFallbackPolicy(policy({order:['eleva','buckpay']}));let attempts=0,keys=[];
 globalThis.fetch=async(url,init)=>{calls.push(url);keys.push(init.headers['Idempotency-Key']);return ++attempts===1?Response.json({success:false},{status:408}):denied();};
 const sale=body({customer:{email:'buyer@example.test'}});assert.equal((await orders.POST(req(sale))).status,502);assert.equal(calls.length,2);assert.equal(keys[0],keys[1]);assert.equal(rows().length,1);assert.equal(rows()[0].state,'unconfirmed');assert.equal((await orders.POST(req(sale))).status,502);assert.equal(calls.length,3);assert.ok(calls.every(url=>url.includes('elevapayments')));assert.equal(rows()[0].state,'unconfirmed');
});

test('store order confirms the actual fallback charge and reuses its link',async()=>{
 await gates.saveFallbackPolicy(policy());globalThis.fetch=async(url,init)=>{calls.push(url);return url.includes('realtechdev')?denied():fireGood(JSON.parse(init.body).amount);};
 const id=crypto.randomUUID(),order={id,items:[{id:'pesca',size:'M',quantity:1,custom:''}],customer:{name:'Cliente Teste',email:'cliente@example.test',cpf:'52998224725',phone:'11999999999'},address:'Rua Teste, 10, Centro, São Paulo, SP, CEP 01001-000',shipping:{cep:'01001000',state:'SP',street:'Rua Teste',number:'10',district:'Centro',city:'São Paulo'}};
 assert.equal((await shop.POST(req(order))).status,200);const r=await shop.POST(req({id,action:'pay'}));assert.equal(r.status,200);const {url}=await r.json(),paymentId=url.split('/').pop();assert.equal(rows().length,2);assert.equal(rows().find(row=>row.id===paymentId).provider,'firebot');
 db.prepare('UPDATE payment_orders SET state=? WHERE id=?').run('paid',paymentId);
 const info=await (await shop.GET(new Request(origin+'/?id='+id))).json();assert.equal(info.paid,true);assert.equal(info.paymentUrl,url);assert.equal('customer' in info,false);
 globalThis.__headers.set('oai-authenticated-user-id','owner');globalThis.__headers.set('oai-authenticated-user-email','owner@example.test');const summary=await (await shopAdmin.GET(new Request(origin))).json();assert.equal(summary.orders.find(o=>o.id===id).payment_state,'paid');
 assert.equal((await shop.POST(req({id,action:'pay'}))).status,200);assert.equal(calls.length,2);
});

for(const primary of ['gestao','firebot','poseidon','eleva','beehive'])test(primary+' confirmed refusal uses the configured reserve',async()=>{
 await choose(primary);await gates.saveFallbackPolicy(policy({order:[primary,'buckpay']}));
 const customer={name:'Cliente Teste',email:'buyer@example.test',cpf:'52998224725',phone:'11999999999',address:'Rua Teste, 10, Centro, São Paulo, SP, CEP 01001-000'};
 if(primary==='beehive')await bee.configureBeehiveCustomer(customer);
 globalThis.fetch=async(url,init)=>{calls.push(url);return url.includes('realtechdev')?buckGood(JSON.parse(init.body).amount):denied();};
 const request=req(body({customer}));request.headers.set('cf-connecting-ip','127.0.0.1');
 const r=await orders.POST(request);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));assert.equal(calls.length,2);assert.equal(rows().length,2);assert.equal(rows().find(row=>row.state==='ready').provider,'buckpay');
});

test('all gateways paused prevents new charges until cooldown or manual reactivation',async()=>{
 await gates.saveFallbackPolicy(policy());globalThis.fetch=async url=>{calls.push(url);return denied();};
 const sale=body();assert.equal((await orders.POST(req(sale))).status,503);assert.equal(calls.length,2);assert.equal((await (await get(10000)).json()).configured,false);
 const blocked=await orders.POST(req(body()));assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'GATEWAYS_UNAVAILABLE');assert.equal(calls.length,2);assert.equal((await orders.POST(req(sale))).status,503);assert.equal(calls.length,2);
 await choose();assert.equal((await (await get(10000)).json()).configured,true);
});
