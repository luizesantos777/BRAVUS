import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const db=new DatabaseSync(':memory:');db.exec(readFileSync('drizzle/0000_bitter_king_bedlam.sql','utf8'));db.exec(readFileSync('drizzle/0001_stale_reaper.sql','utf8'));db.exec(readFileSync('drizzle/0002_complex_roulette.sql','utf8'));db.exec(readFileSync('drizzle/0003_hot_wrecker.sql','utf8'));db.exec(readFileSync('drizzle/0004_attendant-checkout.sql','utf8'));
globalThis.__env={
 ADMIN_EMAIL:'owner@example.test',
 PAYMENT_VAULT_KEY:Buffer.alloc(32,12).toString('base64'),
 DB:{prepare(sql){return {bind(...args){return {
  async first(){return db.prepare(sql).get(...args)},
  async all(){return {results:db.prepare(sql).all(...args)}},
  async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
 }}}}}
};
globalThis.__headers=new Headers();globalThis.__panelCookie='';
const temp=mkdtempSync(join(tmpdir(),'bravus-tests-'));
const plugin={name:'runtime-test',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},x=>({path:x.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:x.path==='cloudflare:workers'?'export const env=globalThis.__env':'export async function headers(){const h=new Headers(globalThis.__headers);if(globalThis.__panelCookie)h.set("cookie",globalThis.__panelCookie);return h}',loader:'js'}))}};
async function load(entry,name){const out=join(temp,name+'.mjs');await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[plugin]});return import(pathToFileURL(out).href)}
const settings=await load('app/api/settings/route.ts','settings'),orders=await load('app/api/orders/route.ts','orders'),pay=await load('app/api/pay/[id]/route.ts','pay');
const origin='https://bravus-atendimento-v2.luizlucrocerto.chatgpt.site';
const customOrigin='https://pagamento.bravuspix.shop';
const request=(body,source=origin)=>new Request(origin+'/api/orders',{method:'POST',headers:{origin:source,'Content-Type':'application/json'},body:JSON.stringify(body)});
let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No unintended API calls')};
assert.equal((await orders.POST(request({amount:999,requestId:crypto.randomUUID()}))).status,409);
globalThis.__headers=new Headers({'oai-authenticated-user-id':'trusted-test-id','oai-authenticated-user-email':'owner@example.test'});
if(typeof globalThis.__savedPanelCookie==='string')globalThis.__panelCookie=globalThis.__savedPanelCookie;
assert.equal((await orders.POST(request({},'https://attacker.test'))).status,403);
assert.equal((await orders.POST(request({amount:0,requestId:crypto.randomUUID()}))).status,400);
assert.equal((await orders.POST(request({amount:2147483648,requestId:crypto.randomUUID()}))).status,400);
assert.equal((await orders.POST(request({amount:999,requestId:crypto.randomUUID()}))).status,409);
assert.equal(calls,0);
const access=await load('app/api/admin/gateway-access/route.ts','gateway-access');
assert.equal((await settings.POST(request({token:'x'.repeat(40),agent:'test-agent'}))).status,403);
assert.equal((await access.POST(request({action:'setup',password:'test-pass-123'},'https://attacker.test'))).status,403);
const setupPassword=await access.POST(request({action:'setup',password:'test-pass-123'}));assert.equal(setupPassword.status,200);
const sessionCookie=setupPassword.headers.get('set-cookie');assert.match(sessionCookie,/HttpOnly; Secure; SameSite=Strict/);
globalThis.__panelCookie=sessionCookie.split(';')[0];globalThis.__savedPanelCookie=globalThis.__panelCookie;
assert.equal((await (await access.GET(new Request(origin))).json()).unlocked,true);
const originalCookie=globalThis.__panelCookie;globalThis.__panelCookie=originalCookie+'tampered';
assert.equal((await (await access.GET(new Request(origin))).json()).unlocked,false);
globalThis.__panelCookie='';
for(let i=0;i<5;i++)assert.equal((await access.POST(request({action:'login',password:'wrong-password'}))).status,401);
assert.equal((await access.POST(request({action:'login',password:'test-pass-123'}))).status,429);
db.prepare("DELETE FROM payment_settings WHERE key='gateway_login_attempts'").run();
const unlock=await access.POST(request({action:'login',password:'test-pass-123'}));assert.equal(unlock.status,200);
globalThis.__panelCookie=unlock.headers.get('set-cookie').split(';')[0];globalThis.__savedPanelCookie=globalThis.__panelCookie;
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_settings').all()).includes('test-pass-123'));
const token='x'.repeat(40);assert.equal((await settings.POST(request({token,agent:'test-agent'}))).status,200);
assert.equal((await settings.POST(request({token:'y'.repeat(40),agent:'changed-agent'}))).status,409);
assert.ok(!db.prepare('SELECT value FROM payment_settings').get().value.includes(token));
assert.deepEqual(await (await settings.GET(new Request(origin))).json(),{configured:true,provider:'buckpay'});
let count=0;globalThis.fetch=async(url,init)=>{count++;assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.headers['User-Agent'],'test-agent');const body=JSON.parse(init.body);assert.equal(body.amount,9989);return Response.json({data:{total_amount:9989,pix:{code:'000201-test-code',qrcode_base64:'aGVsbG8='}}},{status:201})};
const data={amount:9989,requestId:crypto.randomUUID()};const response=await orders.POST(request(data,customOrigin));assert.equal(response.status,200);const result=await response.json();assert.match(result.url,/^https:\/\/pagamento\.bravuspix\.shop\/pagar\/[a-f0-9-]+$/);assert.equal((await orders.POST(request(data,customOrigin))).status,200);assert.equal(count,1);
const id=result.url.split('/').pop();globalThis.__headers=new Headers();globalThis.__panelCookie='';globalThis.fetch=async()=>Response.json({data:{status:'paid',total_amount:100}});
let payment=await (await pay.GET(new Request(origin),{params:Promise.resolve({id})})).json();assert.equal(payment.paid,false);assert.equal(payment.amount,9989);assert.equal(payment.code,'000201-test-code');assert.ok(!JSON.stringify(payment).includes(token));
db.prepare('UPDATE payment_orders SET checked_at=0').run();globalThis.fetch=async()=>Response.json({data:{status:'paid',total_amount:9989}});payment=await (await pay.GET(new Request(origin),{params:Promise.resolve({id})})).json();assert.equal(payment.paid,true);assert.equal(payment.code,null);
assert.equal((await pay.GET(new Request(origin),{params:Promise.resolve({id:'bad'})})).status,404);
assert.equal((await settings.GET(new Request(origin))).status,200);


// BuckPay failures expose a safe diagnostic and recovery only performs GET.
let failedExternal='',recoveryPosts=0;
const failedBuck={amount:9989,sellerName:'Vendedor Seguro',requestId:crypto.randomUUID()};
globalThis.fetch=async(url,init)=>{recoveryPosts++;failedExternal=JSON.parse(init.body).external_id;return Response.json({error:{message:'Invalid buyer',detail:token+' Vendedor Seguro contato@example.com 52998224725'}},{status:400});};
const rejected=await orders.POST(request(failedBuck));assert.equal(rejected.status,502);const rejection=await rejected.json();assert.equal(rejection.code,'BUCKPAY_HTTP_400');assert.ok(!JSON.stringify(rejection).includes(token));assert.ok(!JSON.stringify(rejection).includes('contato@example.com'));
globalThis.fetch=async(url,init)=>{assert.ok(!init.method||init.method==='GET');assert.equal(url,'https://api.realtechdev.com.br/v1/transactions/external_id/'+failedExternal);return Response.json({data:{id:'buck-recovery',external_id:failedExternal,status:'pending',payment_method:'pix',total_amount:1,pix:{code:'000201-recovery'}}});};
assert.equal((await orders.POST(request(failedBuck))).status,502);
globalThis.fetch=async()=>Response.json({error:{message:'Not found'}},{status:404});
assert.equal((await orders.POST(request(failedBuck))).status,409);
globalThis.fetch=async()=>Response.json({data:{id:'buck-recovery',external_id:failedExternal,status:'pending',payment_method:'pix',total_amount:9989,pix:{code:'000201-recovery'}}});
const recovered=await orders.POST(request(failedBuck));assert.equal(recovered.status,200);assert.equal(recoveryPosts,1);
const recoveredId=(await recovered.json()).url.split('/').pop();
const recoveredView=await (await pay.GET(new Request(origin),{params:Promise.resolve({id:recoveredId})})).json();assert.match(recoveredView.qrUrl,/^data:image\/svg/);assert.ok(!JSON.stringify(recoveredView).includes('Vendedor Seguro'));
console.log('Passed: BuckPay safe error diagnostics, read-only recovery, amount mismatch rejection, not-found handling and recovered QR.');
const admin=await load('app/api/admin/poseidon/route.ts','poseidon-admin');
assert.equal((await admin.POST(request({publicKey:'public-poseidon-key',secretKey:'secret-poseidon-test'}))).status,403);
assert.equal((await admin.GET(new Request(origin))).status,403);
globalThis.__headers=new Headers({'oai-authenticated-user-id':'trusted-test-id','oai-authenticated-user-email':'owner@example.test'});
if(typeof globalThis.__savedPanelCookie==='string')globalThis.__panelCookie=globalThis.__savedPanelCookie;
assert.equal((await admin.POST(request({publicKey:'public-poseidon-key',secretKey:'secret-poseidon-test'},'https://attacker.test'))).status,403);
globalThis.fetch=async()=>Response.json({success:false},{status:401});
assert.equal((await admin.POST(request({publicKey:'public-poseidon-key',secretKey:'secret-poseidon-test'}))).status,422);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'buckpay');
const fireKey='private-poseidon-integration-key';
globalThis.fetch=async(url,init)=>{assert.equal(url,'https://app.poseidonpay.site/api/v1/gateway/producer/credentials');assert.equal(init.headers['x-secret-key'],fireKey);return Response.json({name:"CAMISETA",permissions:["PRODUCER_TRANSACTIONS"],grantAllPermissions:false,expiresAt:null});};
assert.equal((await admin.POST(request({publicKey:'public-poseidon-key',secretKey:fireKey,activate:false}))).status,200);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'buckpay');
assert.equal((await admin.POST(request({publicKey:'public-poseidon-key',secretKey:fireKey}))).status,200);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'poseidon');
assert.equal(db.prepare("SELECT count(*) AS count FROM payment_settings WHERE key IN ('buckpay','firebot','poseidon','gestao')").get().count,2);
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_settings').all()).includes(fireKey));
globalThis.fetch=async()=>Response.json({success:false});
assert.equal((await admin.POST(request({publicKey:'public-poseidon-key',secretKey:'bad-replacement-key'}))).status,503);
globalThis.__headers=new Headers();globalThis.__panelCookie='';
let fireCalls=0;
globalThis.fetch=async(url,init)=>{fireCalls++;assert.equal(url,'https://app.poseidonpay.site/api/v1/gateway/pix/receive');assert.equal(init.headers['x-secret-key'],fireKey);const body=JSON.parse(init.body);assert.equal(body.amount,99.89);assert.equal(body.shippingFee,undefined);assert.equal(body.products[0].physical,true);assert.equal(body.client.name,'Comprador de Teste');assert.equal(body.identifier,physical.requestId);assert.equal(init.headers['x-public-key'],'public-poseidon-key');return Response.json({transactionId:'poseidon_tx_test',status:'OK',pix:{code:'000201-poseidon-test',base64:''}});};
const physical={amount:9989,requestId:crypto.randomUUID(),customer:{name:'Comprador de Teste',email:'test@example.test',cpf:'52998224725',phone:'11999999999'},shipping:{street:'Rua Teste',number:'123',complement:'',neighborhood:'Centro',city:'São Paulo',state:'SP',zipCode:'01001000',shippingFee:500}};
assert.equal((await orders.POST(request({...physical,customer:{...physical.customer,cpf:'11111111111'}}))).status,400);
assert.equal(fireCalls,0);
const results=await Promise.all([orders.POST(request(physical)),orders.POST(request(physical))]);
assert.equal(fireCalls,1);assert.ok(results.some(x=>x.status===200));
const fireResult=await (await orders.POST(request(physical))).json();assert.ok(fireResult.url);assert.equal(fireCalls,1);
assert.equal((await orders.POST(request({...physical,amount:10000}))).status,409);
const fireId=fireResult.url.split('/').pop();
globalThis.fetch=async()=>{throw Error('Poseidon must not query payment status')};
const firePayment=await (await pay.GET(new Request(origin),{params:Promise.resolve({id:fireId})})).json();
assert.equal(firePayment.paid,false);assert.equal(firePayment.canVerify,false);assert.ok(firePayment.qrUrl.startsWith('data:image/svg+xml;base64,'));assert.ok(!JSON.stringify(firePayment).includes(fireKey));
let failedCalls=0;globalThis.fetch=async()=>{failedCalls++;throw Error('provider timeout')};
const uncertain={...physical,requestId:crypto.randomUUID()};assert.equal((await orders.POST(request(uncertain))).status,502);assert.equal((await orders.POST(request(uncertain))).status,409);assert.equal(failedCalls,1);
assert.ok(!db.prepare('SELECT * FROM payment_orders WHERE id=?').get(fireId).payload_hash.includes('52998224725'));

const fireAdmin=await load('app/api/admin/firebot/route.ts','firebot-admin');
assert.equal((await fireAdmin.POST(request({secretKey:'test-firebot-key'}))).status,403);
globalThis.__headers=new Headers({'oai-authenticated-user-id':'trusted-test-id','oai-authenticated-user-email':'owner@example.test'});
if(typeof globalThis.__savedPanelCookie==='string')globalThis.__panelCookie=globalThis.__savedPanelCookie;
globalThis.fetch=async()=>Response.json({success:false},{status:401});
assert.equal((await fireAdmin.POST(request({secretKey:'test-firebot-key'}))).status,422);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'poseidon');
// Missing auth route falls back only to the documented account endpoint.
for(const accountResponse of [()=>Response.json({success:false},{status:401}),()=>new Response('missing',{status:404}),()=>Response.json({success:true}),()=>new Response('<html>error</html>')]){
 globalThis.fetch=async(url)=>url.endsWith('/auth')?new Response(null,{status:404}):accountResponse();
 const rejected=await fireAdmin.POST(request({secretKey:'test-firebot-key'}));assert.ok(rejected.status>=400);
 assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'poseidon');
}
let validationPaths=[];
globalThis.fetch=async(url,init)=>{validationPaths.push(url);assert.equal(init.headers['x-api-key'],'test-firebot-key');assert.equal(init.redirect,'manual');return url.endsWith('/auth')?new Response(null,{status:404}):Response.json({success:true,account:{id:'test-account',email:'private@example.test'}});};
assert.equal((await fireAdmin.POST(request({secretKey:'test-firebot-key',activate:false}))).status,200);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'poseidon');validationPaths=[];
const activated=await fireAdmin.POST(request({secretKey:'test-firebot-key'}));assert.equal(activated.status,200);assert.deepEqual(await activated.json(),{configured:true});
assert.deepEqual(validationPaths,['https://firebotbr.com/api/v1/auth','https://firebotbr.com/api/v1/account']);
globalThis.fetch=async(url,init)=>{assert.equal(url,'https://firebotbr.com/api/v1/auth');assert.equal(init.headers['x-api-key'],'test-firebot-key');assert.equal(init.redirect,'manual');return Response.json({success:true});};
assert.equal((await fireAdmin.POST(request({secretKey:'test-firebot-key'}))).status,200);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'firebot');
assert.equal(db.prepare("SELECT count(*) AS n FROM payment_settings WHERE key IN ('buckpay','firebot','poseidon','gestao')").get().n,3);
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_settings').all()).includes('test-firebot-key'));
globalThis.__headers=new Headers();globalThis.__panelCookie='';
let digitalCalls=0;
globalThis.fetch=async(url,init)=>{digitalCalls++;assert.equal(url,'https://firebotbr.com/api/v1/pix/create');const b=JSON.parse(init.body);assert.equal(b.productType,'DIGITAL');assert.equal(b.amount,99.89);assert.equal(b.customer.address,'Rua Exemplo, 10, Centro, São Paulo, SP, 01001000');assert.equal(b.storeUrl,customOrigin+'/checkout');assert.equal(b.shipping,undefined);return Response.json({success:true,amount:99.89,transactionId:'fire_tx_test',pixCopiaECola:'000201-firebot-test',status:'PENDING'});};
const digital={...physical,requestId:crypto.randomUUID(),customer:{...physical.customer,address:'Rua Exemplo, 10, Centro, São Paulo, SP, 01001000'}};
assert.equal((await orders.POST(request({...digital,customer:{...digital.customer,address:''}}))).status,400);
assert.equal(digitalCalls,0);
for(const [key,value,message] of [['name','Ana',/nome completo/],['email','email-invalido',/e-mail/],['cpf','11111111111',/CPF ou CNPJ/],['phone','1234',/telefone/],['address','',/endereço completo/]]){
 const response=await orders.POST(request({...digital,customer:{...digital.customer,[key]:value}}));
 assert.equal(response.status,400);assert.match((await response.json()).error,message);
}
assert.equal(digitalCalls,0);
const international={...digital,customer:{...digital.customer,phone:'+55 '+digital.customer.phone}};
const digitalResponse=await orders.POST(request(international));assert.equal(digitalResponse.status,200);const digitalUrl=(await digitalResponse.json()).url;
assert.equal((await orders.POST(request(digital))).status,200);assert.equal(digitalCalls,1);
const digitalPayment=await (await pay.GET(new Request(origin),{params:Promise.resolve({id:digitalUrl.split('/').pop()})})).json();assert.equal(digitalPayment.provider,'firebot');assert.equal(digitalPayment.paid,false);assert.equal(digitalPayment.canVerify,false);assert.ok(digitalPayment.qrUrl.startsWith('data:image/svg+xml;base64,'));
console.log('Passed: Firebot digital fields, auth activation, old credentials preserved, encryption, duplicate prevention, PIX rendering, no false paid status.');
// Firebot uses the seller as the temporary buyer name without inventing other buyer fields.
let amountOnlyCalls=0;
globalThis.fetch=async(url,init)=>{amountOnlyCalls++;assert.equal(url,'https://firebotbr.com/api/v1/pix/create');const sent=JSON.parse(init.body);assert.equal(sent.amount,99.89);assert.deepEqual(sent.customer,{name:'Luiz'});assert.equal(sent.description,'Vendedor: Luiz | Produto digital Bravus Brasil — entrega pelo WhatsApp');return Response.json({success:true,amount:99.89,transactionId:'amount-only-tx',pixCopiaECola:'000201-amount-only',status:'PENDING'});};
const amountOnly={amount:9989,requestId:crypto.randomUUID(),customer:{},provider:'firebot',sellerName:'Luiz'};
assert.equal((await orders.POST(request(amountOnly))).status,200);
assert.equal((await orders.POST(request(amountOnly))).status,200);assert.equal(amountOnlyCalls,1);
const amountOnlyUrl=(await (await orders.POST(request(amountOnly))).json()).url;
const identifiedPayment=await (await pay.GET(new Request(origin),{params:Promise.resolve({id:amountOnlyUrl.split('/').pop()})})).json();assert.equal(Object.hasOwn(identifiedPayment,'sellerName'),false);
assert.equal((await orders.POST(request({...amountOnly,sellerName:'Outro vendedor'}))).status,409);
assert.equal((await orders.POST(request({...amountOnly,requestId:crypto.randomUUID(),sellerName:'<script>'}))).status,400);
assert.equal(amountOnlyCalls,1);
assert.equal((await orders.POST(request({...amountOnly,amount:10000}))).status,409);
console.log('Passed: Firebot seller name reaches customer.name without other buyer fields and retries do not duplicate charges.');
const gestaoAdmin=await load('app/api/admin/gestao/route.ts','gestao-admin');
const keys={publicKey:'test-public-gestao',secretKey:'test-secret-gestao'};
assert.equal((await gestaoAdmin.POST(request(keys))).status,403);
globalThis.__headers=new Headers({'oai-authenticated-user-id':'trusted-test-id','oai-authenticated-user-email':'owner@example.test'});
if(typeof globalThis.__savedPanelCookie==='string')globalThis.__panelCookie=globalThis.__savedPanelCookie;
for(const reply of [()=>new Response(null,{status:401}),()=>new Response(null,{status:302,headers:{location:'https://attacker.test'}}),()=>Response.json({success:true}),()=>Response.json({success:false,data:{id:'company-test',cnpj:'12345678000199'}}),()=>Response.json({success:true,data:null}),()=>Response.json({data:[]})]){
 globalThis.fetch=async()=>reply();assert.ok((await gestaoAdmin.POST(request(keys))).status>=400);
 assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'firebot');
}
globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.gestaopayments.com/v1/company');assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Basic '+Buffer.from(keys.publicKey+':'+keys.secretKey).toString('base64'));return Response.json({id:'company-test',cnpj:'12345678000199'});};
assert.equal((await gestaoAdmin.POST(request({...keys,activate:false}))).status,200);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'firebot');
assert.equal((await gestaoAdmin.POST(request(keys))).status,200);
// Regression: company records may be nested under data, and CNPJ may be absent.
for(const company of [{id:'company-test',cnpj:'12345678000199'},{id:'company-test',fantasy_name:'Empresa de teste',cnpj:null}]){
 globalThis.fetch=async()=>Response.json({success:true,data:company});
 assert.equal((await gestaoAdmin.POST(request(keys))).status,200);
}
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'gestao');
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_settings').all()).includes(keys.secretKey));
globalThis.__headers=new Headers();globalThis.__panelCookie='';
let gestaoCalls=0;const gestaoOrder={...physical,requestId:crypto.randomUUID()};
globalThis.fetch=async(url,init)=>{gestaoCalls++;assert.equal(url,'https://api.gestaopayments.com/v1/payment-transaction/create');const b=JSON.parse(init.body);assert.equal(b.amount,9989);assert.equal(b.items[0].unit_price,9989);assert.equal(b.items[0].tangible,false);assert.equal(b.customer.document.type,'cpf');assert.equal(b.customer.phone,'5511999999999');return Response.json({success:true,data:{id:'gestao-tx-test',amount:9989,payment_method:'pix',pix:{qr_code:'000201-gestao-test'}}});};
const gestaoResults=await Promise.all([orders.POST(request(gestaoOrder)),orders.POST(request(gestaoOrder))]);assert.equal(gestaoCalls,1);assert.ok(gestaoResults.some(r=>r.status===200));
const gestaoUrl=(await (await orders.POST(request(gestaoOrder))).json()).url;assert.equal(gestaoCalls,1);
assert.equal((await orders.POST(request({...gestaoOrder,amount:10000}))).status,409);
const gestaoId=gestaoUrl.split('/').pop();
for(const extra of [{id:'wrong-id'},{amount:1},{status:'PENDING'},{}]){
 db.prepare('UPDATE payment_orders SET checked_at=0 WHERE id=?').run(gestaoId);
 globalThis.fetch=async(url)=>{assert.equal(url,'https://api.gestaopayments.com/v1/payment-transaction/info/gestao-tx-test');return Response.json({success:true,data:{id:'gestao-tx-test',amount:9989,payment_method:'pix',status:'PAID',...extra}});};
 const d=await (await pay.GET(new Request(origin),{params:Promise.resolve({id:gestaoId})})).json();assert.equal(d.paid,Object.keys(extra).length===0);assert.equal(d.canVerify,true);
}
// Accept direct/enveloped records, but never explicit failure or amount mismatch.
for(const envelope of [d=>d,d=>({data:d})]){
 globalThis.fetch=async()=>Response.json(envelope({id:'gestao-direct',amount:9989,payment_method:'pix',pix:{qr_code:'000201-test'}}));
 assert.equal((await orders.POST(request({...gestaoOrder,requestId:crypto.randomUUID()}))).status,200);
}
for(const result of [{success:false,data:{id:'bad',amount:9989,payment_method:'pix',pix:{qr_code:'000201-test'}}},{success:true,data:{id:'bad',amount:9990,payment_method:'pix',pix:{qr_code:'000201-test'}}}]){
 globalThis.fetch=async()=>Response.json(result);
 assert.equal((await orders.POST(request({...gestaoOrder,requestId:crypto.randomUUID()}))).status,502);
}
const recoveryOrder={...gestaoOrder,requestId:crypto.randomUUID()};let createCount=0,lookupCount=0;
globalThis.fetch=async(url,init)=>{
 if(init.method==='POST'){createCount++;return Response.json({success:true,data:{id:'gestao-recover',amount:9989,payment_method:'pix',status:'PENDING'}});}
 lookupCount++;assert.equal(url,'https://api.gestaopayments.com/v1/payment-transaction/info/gestao-recover');
 return Response.json({data:{id:'gestao-recover',amount:9989,payment_method:'pix',status:'PENDING',pix:{qr_code:'000201-recovered'}}});
};
assert.equal((await orders.POST(request(recoveryOrder))).status,502);
assert.equal((await orders.POST(request(recoveryOrder))).status,200);
assert.equal(createCount,1);assert.equal(lookupCount,1);
globalThis.fetch=async()=>Response.json({error_messages:['Telefone inválido']},{status:400});
const gestaoRejected=await orders.POST(request({...gestaoOrder,requestId:crypto.randomUUID()}));
assert.equal(gestaoRejected.status,502);assert.match((await gestaoRejected.json()).error,/HTTP 400.*Telefone inválido/);
console.log('Passed: Gestão response envelopes, explicit failure rejection, HTTP detail, and GET-only recovery without duplicate POST.');
let uncertainGestaoCalls=0;globalThis.fetch=async()=>{uncertainGestaoCalls++;throw Error('timeout')};
const uncertainGestao={...gestaoOrder,requestId:crypto.randomUUID()};assert.equal((await orders.POST(request(uncertainGestao))).status,502);assert.equal((await orders.POST(request(uncertainGestao))).status,409);assert.equal(uncertainGestaoCalls,1);
console.log('Passed: Gestão Pay private setup, failed activation preserves provider, Basic Auth, centavos, duplicate protection, payment identity/amount checks, timeout protection.');
const gatewayAdmin=await load('app/api/admin/gateways/route.ts','gateway-admin');
assert.equal((await gatewayAdmin.GET(new Request(origin))).status,403);
assert.equal((await gatewayAdmin.POST(request({provider:'buckpay'}))).status,403);
globalThis.__headers=new Headers({'oai-authenticated-user-id':'trusted-test-id','oai-authenticated-user-email':'owner@example.test'});
if(typeof globalThis.__savedPanelCookie==='string')globalThis.__panelCookie=globalThis.__savedPanelCookie;
assert.equal((await gatewayAdmin.POST(request({provider:'buckpay'},'https://attacker.test'))).status,403);
assert.equal((await gatewayAdmin.POST(request({provider:'unknown'}))).status,400);
const savedBuck=db.prepare("SELECT value FROM payment_settings WHERE key='buckpay'").get().value;
db.prepare("DELETE FROM payment_settings WHERE key='buckpay'").run();
assert.equal((await gatewayAdmin.POST(request({provider:'buckpay'}))).status,409);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'gestao');
db.prepare("INSERT INTO payment_settings (key,value) VALUES ('buckpay',?)").run(savedBuck);
globalThis.fetch=async()=>{throw Error('Switching must never call a payment API')};
for(const provider of ['buckpay','poseidon','firebot','gestao','buckpay']){
 assert.equal((await gatewayAdmin.POST(request({provider}))).status,200);
 assert.equal((await (await settings.GET(new Request(origin))).json()).provider,provider);
 const panel=await (await gatewayAdmin.GET(new Request(origin))).json();assert.equal(panel.active,provider);assert.equal(panel.providers.length,7);
 assert.ok(panel.providers.filter(p=>!['eleva','beehive','atlas'].includes(p.id)).every(p=>p.configured));assert.ok(!JSON.stringify(panel).includes(keys.secretKey));
}
// Existing requests retain their original gateway after switching, with no new charge.
assert.equal((await orders.POST(request({...gestaoOrder,provider:'gestao'}))).status,200);
const stale=await orders.POST(request({...physical,requestId:crypto.randomUUID(),provider:'gestao'}));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'GATEWAY_CHANGED');
let switchedCalls=0;
globalThis.fetch=async(url,init)=>{switchedCalls++;assert.ok(url.includes('/v1/transactions'));assert.equal(init.headers.Authorization,'Bearer '+token);return Response.json({data:{total_amount:9989,pix:{code:'000201-buck-after-switch',qrcode_base64:'aGVsbG8='}}});};
assert.equal((await orders.POST(request({...physical,requestId:crypto.randomUUID(),provider:'buckpay'}))).status,200);assert.equal(switchedCalls,1);
console.log('Passed: owner-only gateway selection, CSRF, missing credentials, persistent switches across all four providers, no secrets exposed, existing payment preserved, stale checkout blocked, new request uses selected gateway.');
// Seller identification is sent to every provider but stays out of public payment data.
for(const provider of ['buckpay','poseidon','gestao']){
 assert.equal((await gatewayAdmin.POST(request({provider}))).status,200);
 let sentCount=0;
 const sellerOrder={...physical,provider,sellerName:'Vendedor Teste',requestId:crypto.randomUUID()};
 globalThis.fetch=async(url,init)=>{
  sentCount++;const sent=JSON.parse(init.body);
  if(provider==='buckpay'){
   assert.deepEqual(sent.buyer,{name:'Vendedor Teste'});
   return Response.json({data:{total_amount:9989,pix:{code:'000201-seller-buck',qrcode_base64:'aGVsbG8='}}});
  }
  const buyer=provider==='poseidon'?sent.client:sent.customer;
  assert.equal(buyer.name,'Vendedor Teste');assert.equal(buyer.email,physical.customer.email);
  return provider==='poseidon'?Response.json({transactionId:'seller-poseidon',status:'OK',pix:{code:'000201-seller-poseidon'}}):Response.json({success:true,data:{id:'seller-gestao',amount:9989,payment_method:'pix',pix:{qr_code:'000201-seller-gestao'}}});
 };
 const created=await orders.POST(request(sellerOrder));assert.equal(created.status,200);
 const sellerId=(await created.json()).url.split('/').pop();
 assert.equal((await orders.POST(request(sellerOrder))).status,200);assert.equal(sentCount,1);
 assert.equal((await orders.POST(request({...sellerOrder,sellerName:'Outro'}))).status,409);
 assert.equal(db.prepare('SELECT seller_name FROM payment_orders WHERE id=?').get(sellerId).seller_name,'Vendedor Teste');
 globalThis.fetch=async()=>Response.json({data:{status:'pending'}});
 const publicPayment=await (await pay.GET(new Request(origin),{params:Promise.resolve({id:sellerId})})).json();
 assert.equal(Object.hasOwn(publicPayment,'sellerName'),false);assert.ok(!JSON.stringify(publicPayment).includes('Vendedor Teste'));
}
console.log('Passed: BuckPay, Poseidon and Gestão Pay seller mapping, private identification and duplicate protection.');
// Gestão again requires complete buyer data before contacting the gateway.
assert.equal((await gatewayAdmin.POST(request({provider:'gestao'}))).status,200);
let invalidGestaoCalls=0;globalThis.fetch=async()=>{invalidGestaoCalls++;throw Error('Must validate first');};
assert.equal((await orders.POST(request({provider:'gestao',amount:9989,sellerName:'Luiz',customer:{},requestId:crypto.randomUUID()}))).status,400);
assert.equal(invalidGestaoCalls,0);
globalThis.__env.GESTAO_DEFAULT_PAYER_NAME='Maria Souza';
globalThis.__env.GESTAO_DEFAULT_PAYER_CPF='52998224725';
globalThis.__env.GESTAO_DEFAULT_PAYER_EMAIL='suporte@example.com';
assert.equal((await orders.POST(request({provider:'gestao',amount:9989,sellerName:'Luiz',customer:{},requestId:crypto.randomUUID()}))).status,400);
let linkedCalls=0;
globalThis.fetch=async(url,init)=>{linkedCalls++;const payload=JSON.parse(init.body);assert.equal(payload.customer.name,'Maria Souza');assert.equal(payload.customer.document.number,'52998224725');assert.equal(payload.customer.email,'suporte@example.com');assert.equal(payload.customer.phone,'5511999999999');return Response.json({success:true,data:{id:'gestao-linked-test',amount:9989,payment_method:'pix',pix:{qr_code:'000201-linked-gestao'}}});};
const linkedOrder={provider:'gestao',amount:9989,sellerName:'Luiz',customer:{phone:'11999999999'},requestId:crypto.randomUUID()};
assert.equal((await orders.POST(request(linkedOrder))).status,200);
assert.equal((await orders.POST(request(linkedOrder))).status,200);assert.equal(linkedCalls,1);
delete globalThis.__env.GESTAO_DEFAULT_PAYER_NAME;delete globalThis.__env.GESTAO_DEFAULT_PAYER_CPF;delete globalThis.__env.GESTAO_DEFAULT_PAYER_EMAIL;

const sessions=await load('lib/checkout-session.ts','checkout-session');
const memory=new Map();const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
storage.setItem('bravus-payment-request','old-request');
assert.deepEqual(sessions.restoreAttempt(storage),{legacy:true});
const attempt={requestId:crypto.randomUUID(),sellerName:'Luiz',amount:'99,89',provider:'gestao',values:{}};
const attendantA={...attempt,requestId:crypto.randomUUID(),sellerName:'Atendente A'};
const attendantB={...attempt,requestId:crypto.randomUUID(),sellerName:'Atendente B'};
assert.deepEqual(sessions.restoreAttempt(storage,'attendant:a'),{legacy:false});
sessions.saveAttempt(storage,attendantA,'attendant:a');
sessions.saveAttempt(storage,attendantB,'attendant:b');
assert.deepEqual(sessions.restoreAttempt(storage),{legacy:true});
assert.deepEqual(sessions.restoreAttempt(storage,'attendant:a'),{attempt:attendantA,legacy:false});
sessions.saveAttempt(storage,attempt);
assert.deepEqual(sessions.restoreAttempt(storage),{attempt,legacy:false});
assert.equal(storage.getItem('bravus-payment-request'),null);
sessions.clearAttempt(storage,'attendant:a');
assert.deepEqual(sessions.restoreAttempt(storage,'attendant:a'),{legacy:false});
assert.deepEqual(sessions.restoreAttempt(storage,'attendant:b'),{attempt:attendantB,legacy:false});
assert.deepEqual(sessions.restoreAttempt(storage),{attempt,legacy:false});
sessions.saveAttempt(storage,{...attempt,url:customOrigin+'/pagar/test'});
assert.equal(sessions.restoreAttempt(storage).attempt.url,customOrigin+'/pagar/test');
sessions.clearAttempt(storage);assert.deepEqual(sessions.restoreAttempt(storage),{legacy:false});
assert.deepEqual(sessions.restoreAttempt(storage,'attendant:b'),{attempt:attendantB,legacy:false});
console.log('Passed: restored attempts retain seller, amount and result; new orders clear stale identity and allow repeated amounts.');

const elevaAdmin=await load('app/api/admin/eleva/route.ts','eleva-admin');
const beforeEleva=(await (await gatewayAdmin.GET(new Request(origin))).json()).active;
assert.equal((await elevaAdmin.POST(request({token:'test-eleva-token',clientId:'test-eleva-client'},'https://attacker.test'))).status,403);
globalThis.fetch=async(url,init)=>{assert.equal(url,'https://app.elevapayments.live/api/v1/balance');assert.equal(init.headers['X-Client-ID'],'test-eleva-client');return Response.json({success:true,data:{balance:0}})};
assert.equal((await elevaAdmin.POST(request({token:'test-eleva-token',clientId:'test-eleva-client'}))).status,200);
assert.equal((await (await gatewayAdmin.GET(new Request(origin))).json()).active,beforeEleva);
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_settings').all()).includes('test-eleva-token'));
assert.equal((await gatewayAdmin.POST(request({provider:'eleva'}))).status,200);
assert.equal((await (await settings.GET(new Request(origin))).json()).provider,'eleva');
globalThis.fetch=async()=>Response.json({success:false},{status:401});
assert.equal((await elevaAdmin.POST(request({token:'bad-eleva-token',clientId:'test-eleva-client'}))).status,422);
console.log('Passed: Eleva admin CSRF, encrypted credentials, explicit selection and failed validation preserves credentials.');
const lock=await access.DELETE(request({}));assert.equal(lock.status,200);assert.match(lock.headers.get('set-cookie'),/Max-Age=0/);
globalThis.__panelCookie='';
assert.equal((await gatewayAdmin.GET(new Request(origin))).status,403);
assert.equal((await gatewayAdmin.POST(request({provider:'gestao'}))).status,403);
assert.equal((await gestaoAdmin.GET(new Request(origin))).status,403);
assert.equal((await settings.GET(new Request(origin))).status,200);
console.log('Passed: password setup, signed secure cookie, tamper rejection, wrong password, rate limit, lock, protected configuration endpoints and public checkout access.');

// Beehive: production auth format, protected setup and no charge to validate keys.
const beeAdmin=await load('app/api/admin/beehive/route.ts','bee-admin');
globalThis.__headers=new Headers({'oai-authenticated-user-id':'trusted-test-id','oai-authenticated-user-email':'owner@example.test'});
if(typeof globalThis.__savedPanelCookie==='string')globalThis.__panelCookie=globalThis.__savedPanelCookie;
globalThis.__panelCookie=sessionCookie.split(';')[0];globalThis.__savedPanelCookie=globalThis.__panelCookie;
let beePosts=0;
globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.conta.paybeehive.com.br/v1/company');assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,'Basic '+Buffer.from('sk_test_beehive:x').toString('base64'));return Response.json({id:77,legalName:'Test company'});};
assert.equal((await beeAdmin.POST(request({token:'pk_live_not_secret'}))).status,400);
assert.equal((await beeAdmin.POST(request({token:'sk_test_beehive',publicKey:'pk_test'}))).status,200);
assert.equal((await beeAdmin.POST(request({token:'sk_test_beehive'}))).status,200);
const managementVault=await load('lib/payments.ts','management-vault');assert.equal((await managementVault.credentials('beehive')).agent,'pk_test');
assert.ok(!db.prepare("SELECT value FROM payment_settings WHERE key='beehive'").get().value.includes('sk_test_beehive'));
assert.equal((await gatewayAdmin.POST(request({provider:'beehive'}))).status,200);
const beeOrder={amount:9989,sellerName:'Vendedor interno',provider:'beehive',requestId:crypto.randomUUID(),customer:{name:'Maria Souza',email:'maria@example.com',cpf:'52998224725',phone:'+55 (11) 99999-9999'}};
const beeReq=b=>{const r=request(b);r.headers.set('cf-connecting-ip','192.0.2.1');return r;};
let beePayload;
globalThis.fetch=async(url,init)=>{beePosts++;assert.equal(init.method,'POST');beePayload=JSON.parse(init.body);assert.equal(beePayload.amount,9989);assert.equal(beePayload.customer.name,'Maria Souza');assert.equal(beePayload.customer.phone,'11999999999');assert.equal(beePayload.items[0].tangible,true);assert.equal(beePayload.metadata.order_id,beeOrder.requestId);return Response.json({id:123,amount:9989,paymentMethod:'pix',status:'waiting_payment',externalRef:beeOrder.requestId,pix:{qrcode:'000201-beehive-test'}});};
assert.equal((await orders.POST(beeReq({...beeOrder,customer:{}}))).status,400);
const beeBackend=await load('lib/beehive.ts','bee-backend');
assert.equal((await orders.POST(beeReq(beeOrder))).status,400);assert.equal(beePosts,0);
for(const phone of ['', '999999999', '00123456789'])await assert.rejects(()=>beeBackend.configureBeehiveCustomer({...beeOrder.customer,phone}));
const customerAdmin=await load('app/api/admin/beehive/customers/route.ts','bee-customer-admin');
const goodCustomer={customer:beeOrder.customer};
const beforeCustomerCalls=beePosts;
assert.equal((await customerAdmin.POST(request(goodCustomer,'https://attacker.test'))).status,403);
const customerCookie=globalThis.__panelCookie;const ownerHeaders=globalThis.__headers;globalThis.__headers=new Headers();globalThis.__panelCookie='';
assert.equal((await customerAdmin.POST(request(goodCustomer))).status,403);globalThis.__headers=ownerHeaders;globalThis.__panelCookie=customerCookie;
const ownerCookie=globalThis.__panelCookie;globalThis.__panelCookie='';
assert.equal((await customerAdmin.POST(request(goodCustomer))).status,403);globalThis.__panelCookie=ownerCookie;
assert.equal((await customerAdmin.POST(request({customer:{...beeOrder.customer,phone:''}}))).status,400);
const customerSaved=await customerAdmin.POST(request(goodCustomer));assert.equal(customerSaved.status,200);assert.deepEqual(await customerSaved.json(),{saved:true});
assert.equal(beePosts,beforeCustomerCalls);

assert.ok(!JSON.stringify(db.prepare("SELECT * FROM payment_settings WHERE key LIKE 'beehive_customer_%'").all()).includes('52998224725'));
const buyerFull=beeOrder.customer;beeOrder.customer={name:buyerFull.name};

const beeResult=await orders.POST(beeReq(beeOrder));assert.equal(beeResult.status,200);
const beeUrl=(await beeResult.json()).url,beeId=beeUrl.split('/').pop();
assert.equal((await orders.POST(beeReq(beeOrder))).status,200);assert.equal(beePosts,1);
assert.equal((await orders.POST(beeReq({...beeOrder,amount:10000}))).status,409);
for(const amount of [10000,9989]){
 db.prepare('UPDATE payment_orders SET checked_at=0 WHERE id=?').run(beeId);
 globalThis.fetch=async(url,init)=>{assert.equal(init.method,'GET');return Response.json({id:123,amount,paymentMethod:'pix',status:'paid',externalRef:beeOrder.requestId});};
 const result=await (await pay.GET(new Request(origin),{params:Promise.resolve({id:beeId})})).json();assert.equal(result.paid,amount===9989);assert.ok(!JSON.stringify(result).includes('Vendedor interno'));assert.ok(!JSON.stringify(result).includes('Maria'));
}
// New Beehive PIX requests work without a seller; recovery keeps the same charge.
const noSellerBee={...beeOrder,sellerName:undefined,requestId:crypto.randomUUID()};let noSellerPosts=0;
globalThis.fetch=async(url,init)=>{assert.equal(init.method,'POST');noSellerPosts++;return Response.json({id:124,amount:9989,paymentMethod:'pix',status:'waiting_payment',externalRef:noSellerBee.requestId,pix:{qrcode:'000201-no-seller'}});};
assert.equal((await orders.POST(beeReq(noSellerBee))).status,200);
assert.equal((await orders.POST(beeReq(noSellerBee))).status,200);assert.equal(noSellerPosts,1);
assert.equal(db.prepare('SELECT seller_name FROM payment_orders WHERE request_id=?').get(noSellerBee.requestId).seller_name,null);
const uncertainBee={...beeOrder,requestId:crypto.randomUUID()};let uncertainBeeCalls=0;
globalThis.fetch=async()=>{uncertainBeeCalls++;throw Error('Timeout');};
assert.equal((await orders.POST(beeReq(uncertainBee))).status,502);
assert.equal((await orders.POST(beeReq(uncertainBee))).status,502);assert.equal(uncertainBeeCalls,2);
// Preserve redacted provider details, recover only the exact order using GET.
const rejectedBee={...beeOrder,requestId:crypto.randomUUID()};let rejectedPosts=0;
globalThis.fetch=async()=>{rejectedPosts++;return Response.json({message:'Falha no provedor PIX',error:{message:'Conta Maria Souza maria@example.com 52998224725 sk_test_beehive'}},{status:424});};
const bee424=await orders.POST(beeReq(rejectedBee));assert.equal(bee424.status,502);
const bee424Body=await bee424.json();assert.match(bee424Body.error,/HTTP 424.*Falha no provedor PIX/);
for(const secret of ['Maria Souza','maria@example.com','52998224725','sk_test_beehive'])assert.ok(!bee424Body.error.includes(secret));
globalThis.fetch=async(url,init)=>{assert.equal(init.method,'GET');return Response.json([{id:777,externalRef:'another-order',amount:9989,paymentMethod:'pix'}]);};
assert.equal((await orders.POST(beeReq(rejectedBee))).status,502);assert.equal(rejectedPosts,1);
globalThis.fetch=async(url,init)=>{assert.equal(init.method,'GET');const d={id:778,externalRef:rejectedBee.requestId,amount:9989,paymentMethod:'pix',status:'waiting_payment',pix:{qrCode:'000201-recovered-bee'}};return Response.json(url.includes('?')?[d]:d);};
assert.equal((await orders.POST(beeReq(rejectedBee))).status,200);assert.equal(rejectedPosts,1);
console.log('Passed: Beehive 424 explanation redacted and preserved; exact-reference GET recovery, no duplicate charge.');
const hook=await load('app/api/webhooks/beehive/route.ts','bee-hook');
assert.equal((await hook.POST(new Request(origin,{method:'POST',body:JSON.stringify({type:'transaction',objectId:123,data:{externalRef:crypto.randomUUID(),status:'paid'}})}))).status,200);
// Forged paid webhooks cannot mark an unpaid transaction paid.
db.prepare("UPDATE payment_orders SET state='ready',checked_at=0 WHERE id=?").run(beeId);
globalThis.fetch=async()=>Response.json({id:123,amount:9989,paymentMethod:'pix',status:'waiting_payment',externalRef:beeOrder.requestId});
const hookRequest=()=>new Request(origin,{method:'POST',body:JSON.stringify({type:'transaction',objectId:123,data:{externalRef:beeOrder.requestId,status:'paid'}})});
assert.equal((await hook.POST(hookRequest())).status,200);
assert.equal(db.prepare('SELECT state FROM payment_orders WHERE id=?').get(beeId).state,'ready');
db.prepare('UPDATE payment_orders SET checked_at=0 WHERE id=?').run(beeId);
globalThis.fetch=async()=>Response.json({id:123,amount:9989,paymentMethod:'pix',status:'paid',externalRef:beeOrder.requestId});
assert.equal((await hook.POST(hookRequest())).status,200);
assert.equal(db.prepare('SELECT state FROM payment_orders WHERE id=?').get(beeId).state,'paid');
console.log('Passed: Beehive protected setup, Basic auth, encrypted secret, required customer data, cents, QR, seller privacy, duplicate protection and verified paid status.');

const cardOrder={amount:129844,sellerName:'Vendedor privado',provider:'beehive',paymentMethod:'credit_card',requestId:crypto.randomUUID()};
globalThis.fetch=async()=>{throw Error('Draft must not call provider');};
const cardResponse=await orders.POST(request(cardOrder));assert.equal(cardResponse.status,200);
const cardUrl=(await cardResponse.json()).url;assert.ok(cardUrl.startsWith(customOrigin+'/cartao/'));
const cardId=cardUrl.split('/').pop(),cardCtx={params:Promise.resolve({id:cardId})};
assert.equal((await orders.POST(request(cardOrder))).status,200);
assert.equal((await orders.POST(request({...cardOrder,amount:129845}))).status,409);
const cardApi=await load('app/api/card/[id]/route.ts','direct-card-api');
const info=await (await cardApi.GET(new Request(origin),cardCtx)).json();assert.equal(info.state,'card_draft');assert.ok(!JSON.stringify(info).includes('Vendedor privado'));assert.ok(!JSON.stringify(info).includes('sk_test_beehive'));
const cardBody={cardToken:'token_test_123456',customer:buyerFull,installments:12,acceptedAmount:180483};
const cardLimits=await load('lib/gateway-amount-limits.ts','card-amount-limits');
assert.deepEqual(cardLimits.gatewayCardPlans(1,null).map(plan=>plan.installments),[1]);
await cardLimits.saveGatewayAmountLimits('beehive',{pix:null,credit_card:{minCents:null,maxCents:150000}});
const limitedPlans=(await (await cardApi.GET(new Request(origin),cardCtx)).json()).plans;
assert.deepEqual(limitedPlans.map(plan=>plan.installments),[1]);
const limitedCharge=await cardApi.POST(beeReq(cardBody),cardCtx);
assert.equal(limitedCharge.status,400);
assert.equal((await limitedCharge.json()).code,'AMOUNT_LIMIT');
assert.equal(db.prepare('SELECT state FROM payment_orders WHERE id=?').get(cardId).state,'card_draft');
await cardLimits.saveGatewayAmountLimits('beehive',{pix:null,credit_card:null});
for(const installments of [0,13,-1,1.5,'12',null])assert.equal((await cardApi.POST(beeReq({...cardBody,installments}),cardCtx)).status,400);
assert.equal((await cardApi.POST(beeReq({...cardBody,cvv:'123'}),cardCtx)).status,400);
assert.equal((await cardApi.POST(beeReq({...cardBody,card:{number:'4111111111111111'}}),cardCtx)).status,400);
assert.equal((await cardApi.POST(request(cardBody,'https://evil.invalid'),cardCtx)).status,403);
assert.equal(info.plans[11].amount,180483);
for(const acceptedAmount of [undefined,129844,180484])assert.equal((await cardApi.POST(beeReq({...cardBody,acceptedAmount}),cardCtx)).status,400);
const pricing=await load('lib/card-pricing.ts','pricing');
assert.equal(pricing.cardPlan(10000,2).amount,12300);
for(let n=1;n<=12;n++)for(const base of [600,9989,10000,129844]){const p=pricing.cardPlan(base,n);assert.equal((n-p.higherCount)*p.installmentAmount+p.higherCount*(p.installmentAmount+1),p.amount);}
let cardCreates=0;
globalThis.fetch=async(url,init)=>{cardCreates++;assert.equal(url,'https://api.conta.paybeehive.com.br/v1/transactions');const b=JSON.parse(init.body);assert.equal(b.paymentMethod,'credit_card');assert.equal(b.card.hash,cardBody.cardToken);assert.equal(b.amount,180483);assert.equal(b.items.reduce((s,i)=>s+i.unitPrice*i.quantity,0),180483);assert.equal(b.installments,12);assert.equal(b.pix,undefined);return Response.json({id:8001,amount:180483,paymentMethod:'credit_card',installments:12,status:'authorized',externalRef:cardOrder.requestId});};
const cardResults=await Promise.all([cardApi.POST(beeReq(cardBody),cardCtx),cardApi.POST(beeReq(cardBody),cardCtx)]);assert.equal(cardCreates,1);assert.ok(cardResults.every(r=>r.status===200));
assert.equal(db.prepare('SELECT state FROM payment_orders WHERE id=?').get(cardId).state,'card_pending');
assert.equal((await (await cardApi.GET(new Request(origin),cardCtx)).json()).installments,12);
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM payment_orders WHERE id=?').get(cardId)).includes(cardBody.cardToken));
for(const paymentMethod of ['pix','credit_card']){
 db.prepare('UPDATE payment_orders SET checked_at=0 WHERE id=?').run(cardId);
 globalThis.fetch=async(url,init)=>{assert.equal(init.method,'GET');return Response.json({id:8001,amount:180483,paymentMethod,status:'paid',externalRef:cardOrder.requestId});};
 const d=await (await cardApi.GET(new Request(origin),cardCtx)).json();assert.equal(d.paid,paymentMethod==='credit_card');
}
const nextCard={...cardOrder,requestId:crypto.randomUUID()};const nextUrl=(await (await orders.POST(request(nextCard))).json()).url;const nextCtx={params:Promise.resolve({id:nextUrl.split('/').pop()})};
let timeoutCreates=0;globalThis.fetch=async()=>{timeoutCreates++;throw Error('timeout');};
assert.equal((await cardApi.POST(beeReq(cardBody),nextCtx)).status,502);
assert.equal((await cardApi.POST(beeReq(cardBody),nextCtx)).status,200);assert.equal(timeoutCreates,1);
const browser=await load('lib/beehive-browser.ts','bee-browser');let sequence=[];
const sdk={setPublicKey:async()=>sequence.push('key'),setTestMode:()=>sequence.push('mode'),is3DSAvailable:async()=>true,authenticate3DS:async input=>{assert.equal(input.installments,12);sequence.push('3ds')},encrypt:async()=>{sequence.push('token');return 'token_synthetic_123';}};
assert.equal(await browser.tokenizeCard(sdk,'pk_live_test',10000,{},12),'token_synthetic_123');assert.deepEqual(sequence,['key','mode','3ds','token']);
sequence=[];sdk.authenticate3DS=async()=>{throw Error('Challenge cancelled');};await assert.rejects(browser.tokenizeCard(sdk,'pk_live_test',10000,{}));assert.ok(!sequence.includes('token'));
console.log('Passed: first-party card link, no PAN/CVV accepted, token-only request, 3DS before tokenization, no duplicate charge, no token stored, authorized not paid, method validation and timeout recovery.');
rmSync(temp,{recursive:true,force:true});
console.log('Passed: Poseidon owner-only setup, auth validation, encrypted key replacement, fallback preservation, reais amount, physical data, concurrent duplicates, timeout replay blocking, and no invented payment verification.');
console.log('Passed: owner access, CSRF, amount limits, encrypted credentials, duplicate prevention, public code access and paid verification.');

// Password-only gateway administration: no ChatGPT identity needed.
globalThis.__headers=new Headers();globalThis.__panelCookie='';
assert.equal((await gatewayAdmin.GET(new Request(origin))).status,403);
const anonymousLogin=await access.POST(request({action:'login',password:'test-pass-123'},customOrigin));
assert.equal(anonymousLogin.status,200);globalThis.__panelCookie=anonymousLogin.headers.get('set-cookie').split(';')[0];
assert.equal((await gatewayAdmin.GET(new Request(origin))).status,200);
assert.equal((await beeAdmin.GET(new Request(origin))).status,200);
assert.equal((await customerAdmin.POST(request({customer:buyerFull},customOrigin))).status,200);
assert.equal((await gatewayAdmin.POST(request({provider:'beehive'},'https://attacker.test'))).status,403);
const storeGuard=await load('lib/gateway-access.ts','store-owner-guard');
assert.equal((await storeGuard.ownerPanelGuard(request({}))).status,403);
const cookieGood=globalThis.__panelCookie;globalThis.__panelCookie=cookieGood+'tamper';
assert.equal((await gatewayAdmin.GET(new Request(origin))).status,403);
globalThis.__panelCookie='';db.prepare("DELETE FROM payment_settings WHERE key='gateway_panel_password'").run();
assert.equal((await access.POST(request({action:'setup',password:'attacker-pass'}))).status,403);
console.log('Passed: password-only gateway login, anonymous denial, CSRF, tamper rejection, owner-only bootstrap and unchanged store protection.');
