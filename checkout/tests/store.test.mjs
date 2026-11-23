import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const db=new DatabaseSync(':memory:');for(const p of ['0000_bitter_king_bedlam','0001_stale_reaper','0002_complex_roulette','0003_hot_wrecker','0004_attendant-checkout'])db.exec(readFileSync('drizzle/'+p+'.sql','utf8'));
globalThis.__env={ADMIN_EMAIL:'owner@example.test',PAYMENT_VAULT_KEY:Buffer.alloc(32,12).toString('base64'),DB:{prepare(sql){const execute=(args=[])=>({async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}});return {...execute(),bind(...args){return execute(args)}}}}};
globalThis.__headers=new Headers();const tmp=mkdtempSync(join(tmpdir(),'bravus-store-'));
const plugin={name:'mock',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},x=>({path:x.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:x.path==='cloudflare:workers'?'export const env=globalThis.__env':'export async function headers(){return globalThis.__headers}',loader:'js'}))}};
async function load(entry,name){const out=join(tmp,name+'.mjs');await build({entryPoints:[entry],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[plugin]});return import(pathToFileURL(out).href)}
const shop=await load('app/api/store/orders/route.ts','shop'),admin=await load('app/api/store/admin/route.ts','admin'),pricing=await load('lib/store.ts','pricing'),payments=await load('lib/payments.ts','payments'),access=await load('lib/gateway-access.ts','access');
const contact=await load('app/api/store/contact/route.ts','contact');
const origin='https://pagamento.bravuspix.shop';const req=(b)=>new Request(origin+'/api/store/orders',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(b)});
for(const [q,total] of [[1,3990],[2,7980],[3,11970],[4,9989],[5,12485],[8,19976]])assert.equal(pricing.totalFor(q),total);
assert.throws(()=>pricing.validateCart([{id:'pesca',size:'M',quantity:-1,custom:''}]));
const id=crypto.randomUUID();const body={id,items:[{id:'pesca',size:'M',quantity:4,custom:'Equipe teste'}],customer:{name:'Cliente Teste',email:'cliente@example.test',cpf:'52998224725',phone:'11999999999'},address:'Rua de Teste, 10, Centro, São Paulo/SP, CEP 01001-000',amount:1,shipping:{cep:'01001000',state:'SP',street:'Rua Teste',number:'10',district:'Centro',city:'São Paulo'}};
assert.equal((await shop.POST(req({...body,id:crypto.randomUUID(),shipping:{...body.shipping,state:'XX'}}))).status,400);
assert.equal((await shop.POST(req(body))).status,200);
assert.equal((await shop.POST(req(body))).status,200);
let info=await (await shop.GET(new Request(origin+'/?id='+id))).json();assert.equal(info.subtotal,9989);assert.equal(info.freight,1990);assert.equal('customer' in info,false);
assert.equal((await shop.POST(req({...body,items:[{...body.items[0],quantity:5}]}))).status,409);
let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Should not call gateway before freight')};
assert.equal((await shop.POST(req({id,action:'pay'}))).status,409);assert.equal(calls,0);
assert.equal((await admin.GET(new Request(origin))).status,403);
assert.equal((await contact.POST(req({phone:'5511999999999'}))).status,403);
assert.equal((await (await contact.GET()).json()).phone,'5511925585852');
globalThis.__headers=new Headers({'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'});
assert.equal((await admin.POST(req({id,freight:1500,delivery:'10 dias úteis'}))).status,403);
const record=await access.setPanelPassword('test-password-long');const cookie=await access.sessionCookie(record);globalThis.__headers.set('cookie',cookie.split(';')[0]);
assert.equal((await admin.POST(req({id,freight:1500,delivery:'10 dias úteis após aprovação'}))).status,409);
assert.equal((await admin.POST(req({id,freight:1,delivery:'alterado'}))).status,409);
await payments.saveCredentials('x'.repeat(40),'test-agent','buckpay');
globalThis.fetch=async(url,options)=>{calls++;const payload=JSON.parse(options.body);assert.equal(payload.amount,11979);return Response.json({data:{total_amount:11979,pix:{code:'000201-test',qrcode_base64:'aGVsbG8='}}})};
const pay=await shop.POST(req({id,action:'pay',amount:1}));assert.equal(pay.status,200);const url=(await pay.json()).url;assert.match(url,/\/pagar\//);
assert.equal((await shop.POST(req({id,action:'pay'}))).status,200);assert.equal(calls,1);
info=await (await shop.GET(new Request(origin+'/?id='+id))).json();assert.equal(info.paymentUrl,url);assert.equal(info.freight,1990);
assert.equal((await admin.GET(new Request(origin))).status,200);
assert.equal((await contact.POST(req({phone:'123'}))).status,400);
assert.equal((await contact.POST(req({phone:'5511999999999'}))).status,200);
assert.equal((await (await contact.GET()).json()).phone,'5511999999999');
for(const c of pricing.colors){const item=pricing.validateCart([{id:'texas',size:'M',quantity:1,custom:'',color:c.name}]);assert.equal(item.cart[0].color,c.name);}
assert.equal(pricing.colors.length,16);
for(const state of pricing.brazilStates){const nextId=crypto.randomUUID();assert.equal((await shop.POST(req({...body,id:nextId,shipping:{...body.shipping,state},freight:0}))).status,200);const d=await (await shop.GET(new Request(origin+'/?id='+nextId))).json();assert.equal(d.freight,1990);}
assert.equal(pricing.validateCart([{id:'texas',size:'G8',quantity:1,custom:'',color:'Rosa pink'}]).cart[0].size,'G8');

assert.throws(()=>pricing.validateCart([{id:'texas',size:'M',quantity:1,custom:'',color:'invalid'}]));

rmSync(tmp,{recursive:true,force:true});console.log('Store tests passed: pricing, validation, immutable order, shipping gate, admin authorization, calculated total, payment recovery.');

// Every individual shirt can be ordered in its photographed color and valid size.
assert.equal(new Set(pricing.catalog.map(p=>p.id)).size,pricing.catalog.length);
for(const p of pricing.catalog){assert.equal(pricing.validateCart([{id:p.id,size:'M',quantity:1,custom:'',color:p.color}]).cart[0].id,p.id);}
assert.equal(pricing.validateCart([{id:'polo-0',size:'XXG',quantity:1,custom:'',color:'Branco'}]).cart[0].size,'XXG');
assert.throws(()=>pricing.validateCart([{id:'polo-0',size:'G8',quantity:1,custom:'',color:'Branco'}]));
