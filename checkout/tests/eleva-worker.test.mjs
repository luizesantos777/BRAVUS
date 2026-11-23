import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const source=`import {activateEleva,createEleva,readElevaPayment} from './lib/eleva';import {env} from 'cloudflare:workers';export default {async fetch(req){try{const b=await req.json();if(b.op==='setup')return Response.json({ok:await activateEleva('test-token','test-client')});if(b.op==='read'){const row=await env.DB.prepare('SELECT * FROM payment_orders WHERE request_id=?').bind(b.requestId).first();return await readElevaPayment(row);}return await createEleva(b,{token:'test-token',agent:'test-client'});}catch(e){return Response.json({error:e.message},{status:400})}}}`;
const compiled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers'],plugins:[{name:'vault',setup(b){b.onResolve({filter:/^\.\/payments$/},()=>({path:'vault',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`import {env} from 'cloudflare:workers';export const database=()=>env.DB;export const credentials=async()=>({token:'test-token',agent:'test-client'});export const saveCredentials=async()=>{};export const PAYMENT_ORIGIN='https://pagamento.bravuspix.shop';export const json=(d,status=200)=>Response.json(d,{status});`,loader:'js'}));}}]});
let timeoutHits=0,timeoutKeys=[],minimal=false,mode='normal',status='pending',remoteAmount=99.89,requests=[];
const transaction='9d3f1c1e-6a2b-4d7e-9a51-2f0c8b7e4a10';
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],script:compiled.outputFiles[0].text,d1Databases:['DB'],bindings:{ELEVA_DEFAULT_PAYER_NAME:'Maria Souza',ELEVA_DEFAULT_PAYER_CPF:'52998224725'},outboundService:async req=>{
 requests.push(req.url);assert.equal(req.headers.get('Authorization'),'Bearer test-token');assert.equal(req.headers.get('X-Client-ID'),'test-client');
 if(mode==='redirect')return new Response(null,{status:307,headers:{location:'https://untrusted.example/'}});
 if(mode==='flat'&&req.url.endsWith('/balance'))return Response.json({success:true,balance:'0.00'});
 if(mode==='fallback'&&req.url.endsWith('/balance'))return Response.json({success:true});
 if(mode==='fallback'&&req.url.includes('/transactions?'))return Response.json({data:[]});
 if(mode==='denied')return Response.json({success:false},{status:403});
 if(req.url.endsWith('/balance'))return Response.json({success:true,data:{balance:0}});
 if(req.method==='POST'){const p=await req.json();assert.equal(p.amount,99.89);if(minimal){assert.equal('payer_email' in p,false);assert.equal('payer_cpf' in p,false);assert.equal('payer_phone' in p,false);}assert.equal(p.payer_name,'Maria Souza');assert.equal(p.reference,req.headers.get('Idempotency-Key'));assert.ok(!JSON.stringify(p).includes('Vendedor Teste'));}
 if(mode==='timeout-once'||mode==='timeout-always'){timeoutHits++;timeoutKeys.push(req.headers.get('Idempotency-Key'));if(timeoutHits===1||mode==='timeout-always')return Response.json({success:false},{status:408});}
 if(mode==='uncertain')return Response.json({success:false},{status:503});
 return Response.json({success:true,data:{transaction_uuid:transaction,amount:remoteAmount,status,pix_code:'000201010212test-eleva',expires_at:mode==='expired'?'2020-01-01T00:00:00Z':'2099-01-01T00:00:00Z'}},{status:req.method==='POST'?201:200});
}});
const db=await mf.getD1Database('DB');await db.exec('CREATE TABLE payment_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE payment_orders (id TEXT PRIMARY KEY, request_id TEXT UNIQUE, amount INTEGER, state TEXT,created_at INTEGER,checked_at INTEGER,provider TEXT,payload_hash TEXT,seller_name TEXT,origin TEXT,attendant_id TEXT,pix_code TEXT,qr TEXT,transaction_id TEXT);');
const send=async b=>{const r=await mf.dispatchFetch('http://localhost',{method:'POST',body:JSON.stringify(b)});return {status:r.status,data:await r.json()}};
const order={amount:9989,requestId:'11111111-1111-4111-8111-111111111111',sellerName:'Vendedor Teste',customer:{name:'Maria Souza',email:'maria@example.com',cpf:'52998224725'}};
try{
 assert.equal((await send({op:'setup'})).data.ok,true);mode='redirect';assert.equal((await send({op:'setup'})).status,400);mode='normal';assert.equal(requests.length,2);
 assert.equal((await send({...order,customer:{...order.customer,cpf:'11111111111'}})).status,400);assert.equal(requests.length,2);
 const result=await send(order);assert.equal(result.status,200);assert.match(result.data.url,/\/pagar\//);const count=requests.length;
 assert.deepEqual((await send(order)).data,result.data);assert.equal(requests.length,count);
 assert.equal((await send({...order,amount:10000})).status,409);
 await db.prepare('UPDATE payment_orders SET checked_at=0').run();status='completed';let pay=await send({op:'read',requestId:order.requestId});assert.equal(pay.data.paid,true);assert.equal(pay.data.code,null);assert.ok(!JSON.stringify(pay).includes('Vendedor Teste'));
 await db.prepare('UPDATE payment_orders SET checked_at=0').run();remoteAmount=1;assert.equal((await send({op:'read',requestId:order.requestId})).status,400);remoteAmount=99.89;
 status='cancelled';mode='expired';await db.prepare('UPDATE payment_orders SET checked_at=0').run();pay=await send({op:'read',requestId:order.requestId});assert.equal(pay.data.unavailable,true);assert.equal(pay.data.code,null);
 mode='uncertain';const second={...order,requestId:'22222222-2222-4222-8222-222222222222'};assert.equal((await send(second)).status,502);const before=requests.length;assert.equal((await send(second)).status,502);assert.equal(requests.length,before+1);
 await db.prepare('UPDATE payment_orders SET checked_at=0 WHERE request_id=?').bind(second.requestId).run();mode='normal';status='pending';assert.equal((await send(second)).status,200);
 const rows=await db.prepare('SELECT count(*) AS n FROM payment_orders').first();assert.equal(rows.n,2);
 minimal=true;const quick={...order,requestId:'33333333-3333-4333-8333-333333333333',customer:{name:'Maria Souza'}};assert.equal((await send(quick)).status,400);minimal=false;
 remoteAmount='99.89';assert.equal((await send({...order,requestId:'44444444-4444-4444-8444-444444444444'})).status,200);remoteAmount=99.89;
 assert.equal((await send({...order,requestId:'55555555-5555-4555-8555-555555555555',customer:{email:'maria@example.com'}})).status,200);
 mode='timeout-once';timeoutHits=0;timeoutKeys=[];const timeoutOrder={...order,requestId:'66666666-6666-4666-8666-666666666666'};assert.equal((await send(timeoutOrder)).status,200);assert.equal(timeoutHits,2);assert.deepEqual(timeoutKeys,[timeoutOrder.requestId,timeoutOrder.requestId]);
 mode='timeout-always';timeoutHits=0;const persistent=await send({...order,requestId:'77777777-7777-4777-8777-777777777777'});assert.equal(persistent.status,502);assert.equal(timeoutHits,2);assert.match(persistent.data.error,/408/);
 mode='flat';assert.equal((await send({op:'setup'})).data.ok,true);mode='fallback';assert.equal((await send({op:'setup'})).data.ok,true);mode='denied';assert.equal((await send({op:'setup'})).status,400);
 console.log('Eleva Workers tests passed: auth/redirect, validation, reais, idempotency, retry lease, matching amount, confirmation, expiry and seller privacy.');
}finally{await mf.dispose()}
