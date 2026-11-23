import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const db=new DatabaseSync(':memory:');
for(const name of ['0000_bitter_king_bedlam','0001_stale_reaper','0002_complex_roulette','0003_hot_wrecker','0004_attendant-checkout'])db.exec(readFileSync('drizzle/'+name+'.sql','utf8'));
globalThis.__env={ADMIN_EMAIL:'owner@example.test',PAYMENT_VAULT_KEY:Buffer.alloc(32,33).toString('base64'),DB:{prepare(sql){const execute=(args=[])=>({async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}});return {...execute(),bind(...args){return execute(args)}}}}};
globalThis.__headers=new Headers();
const directory=mkdtempSync(join(tmpdir(),'biocamisas-domains-'));
const plugin={name:'test-runtime',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers)$/},x=>({path:x.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},x=>({contents:x.path==='cloudflare:workers'?'export const env=globalThis.__env':'export async function headers(){return globalThis.__headers}',loader:'js'}));}};
async function load(entry,name){const outfile=join(directory,name+'.mjs');await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',plugins:[plugin]});return import(pathToFileURL(outfile).href);}
const brands=await load('lib/checkout-brand.ts','brands'),payments=await load('lib/payments.ts','payments'),orders=await load('app/api/orders/route.ts','orders'),settings=await load('app/api/settings/route.ts','settings'),access=await load('lib/gateway-access.ts','access'),login=await load('app/api/admin/gateway-access/route.ts','login'),gateways=await load('lib/gateways.ts','gateways'),mask=await load('lib/gateway-mask.ts','gateway-mask');
const bio='https://biocamisas.shop',bravus='https://pagamento.bravuspix.shop';
const req=(body,origin=bio,destination=origin)=>new Request(destination+'/api/orders',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
let posts=0;
globalThis.fetch=async(url,init)=>{
  assert.equal(url,'https://api.realtechdev.com.br/v1/transactions');assert.equal(init.method,'POST');posts++;
  const payload=JSON.parse(init.body);assert.equal(payload.amount,10000);
  return Response.json({data:{total_amount:10000,pix:{code:'000201-synthetic-only',qrcode_base64:'aGVsbG8='}}},{status:201});
};

test('a marca depende somente dos domínios conhecidos, com origem canônica e proteção de retorno',async()=>{
  assert.equal(brands.checkoutBrandForOrigin(bio).name,'Bio Camisas');
  assert.equal(brands.checkoutBrandForOrigin('https://www.biocamisas.shop').origin,bio);
  for(const origin of [null,'http://biocamisas.shop','https://biocamisas.shop.attacker.test','https://biocamisas.shop@attacker.test','https://biocamisas.shop:444','https://biocamisas.shop/'])assert.equal(brands.checkoutBrandForOrigin(origin).id,'bravus');
  assert.equal(brands.checkoutBrandForHeaders(new Headers({host:'www.biocamisas.shop'})).id,'biocamisas');
  assert.equal(brands.checkoutBrandForHeaders(new Headers({host:'unknown.test','x-forwarded-host':'biocamisas.shop'})).id,'bravus');
  assert.equal(brands.checkoutBrandForHeaders(new Headers({host:'localhost','x-checkout-origin':bio})).id,'biocamisas');
  assert.equal(brands.checkoutBrandForHeaders(new Headers({host:'biocamisas.shop','x-checkout-origin':bravus})).id,'bravus');
  const id=crypto.randomUUID();
  const mapped=await brands.checkoutResponse(req({}),Response.json({url:bravus+'/pagar/'+id},{headers:{'Cache-Control':'no-store','X-Test':'preserved'}}));
  assert.equal((await mapped.json()).url,bio+'/pagar/'+id);assert.equal(mapped.headers.get('X-Test'),'preserved');assert.match(mapped.headers.get('Cache-Control'),/no-store/);
  for(const url of ['https://outside.test/pagar/'+id,bravus+'/admin/gateways',bravus+'/pagar/'+id+'?secret=1',bravus+'/pagar/not-an-id']){
    const response=Response.json({url});assert.equal(await brands.checkoutResponse(req({}),response),response);assert.equal((await response.json()).url,url);
  }
});

test('um link individual antigo reconhece a Bio Camisas pelo tipo de conta verificado pelo Portal',async()=>{
  const route=await load('app/a/[id]/page.tsx','linked-checkout');
  const partnerId=crypto.randomUUID(),attendantId=crypto.randomUUID();
  const before=globalThis.fetch;
  try{
    globalThis.__headers=new Headers({host:new URL(bravus).host});
    globalThis.fetch=async url=>{
      if(url==='https://bravus-omega.vercel.app/api/public/checkout-attendants/'+partnerId)return Response.json({name:'Parceiro de teste',kind:'partner'});
      if(url==='https://bravus-omega.vercel.app/api/public/checkout-attendants/'+attendantId)return Response.json({name:'Atendente de teste',kind:'attendant'});
      return new Response(null,{status:404});
    };
    const partner=await route.default({params:Promise.resolve({id:partnerId})});
    const attendant=await route.default({params:Promise.resolve({id:attendantId})});
    assert.equal(partner.props.brand.id,'biocamisas');
    assert.equal(partner.props.attendant.id,partnerId);
    assert.equal(attendant.props.brand.id,'bravus');
  }finally{
    globalThis.fetch=before;
    globalThis.__headers=new Headers();
  }
});

test('BIO e BRAVUS usam as mesmas credenciais e recuperam o mesmo PIX sem uma segunda cobrança',async()=>{
  await payments.saveCredentials('fake-shared-token','fake-user-agent','buckpay');
  await gateways.selectGateway('buckpay');
  const body={amount:10000,sellerName:'Vendedor sintético',requestId:crypto.randomUUID()};
  assert.equal((await orders.POST(req(body,'https://attacker.test',bio))).status,403);assert.equal(posts,0);
  for(const origin of [bio,bravus]){
    const response=await settings.GET(new Request(origin+'/api/settings'));assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{configured:true,provider:'buckpay'});
  }
  const first=await orders.POST(req(body));assert.equal(first.status,200);const result=await first.json();
  assert.match(result.url,/^https:\/\/biocamisas\.shop\/pagar\/[a-f0-9-]+$/);
  assert.deepEqual(await (await orders.POST(req(body))).json(),result);
  assert.equal((await (await orders.POST(req(body,bravus))).json()).url,result.url.replace(bio,bravus));
  assert.equal((await (await orders.POST(req(body,'https://www.biocamisas.shop'))).json()).url,result.url);
  assert.equal((await orders.POST(req({...body,amount:20000}))).status,409);
  assert.equal(posts,1);assert.equal(db.prepare('SELECT count(*) AS n FROM payment_orders').get().n,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM payment_settings WHERE key='buckpay'").get().n,1);
  assert.ok(!JSON.stringify(result).includes('fake-shared-token'));
});

test('os dois domínios compartilham a senha e as regras sem liberar administração pública',async()=>{
  assert.equal((await access.panelGuard(req({}))).status,403);
  await access.setPanelPassword('fixture-shared-password');
  const response=await login.POST(req({action:'login',password:'fixture-shared-password'}));assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/__Host-bravus-gateway=.*HttpOnly; Secure; SameSite=Strict/);assert.ok(!cookie.includes('Domain='));
  globalThis.__headers=new Headers({cookie:cookie.split(';')[0]});
  assert.equal(await access.panelGuard(req({})),null);assert.equal(await access.panelGuard(req({},bravus)),null);
  assert.equal((await access.panelGuard(req({},'https://attacker.test',bio))).status,403);
  const policy={enabled:false,autoSwitch:true,order:['buckpay','beehive'],ticketRouting:{enabled:false,rules:[]}};
  await gateways.saveFallbackPolicy(policy);assert.deepEqual(await gateways.fallbackPolicy(),policy);
  globalThis.__headers=new Headers();
});

test('links de cartão usam Bio Camisas e preservam o pedido e a gateway ao reabrir pela BRAVUS',async()=>{
  await payments.saveCredentials('fake-card-token','fake-public-key','beehive');await gateways.selectGateway('beehive');
  const body={amount:10000,paymentMethod:'credit_card',sellerName:'Vendedor sintético',requestId:crypto.randomUUID()};
  const response=await orders.POST(req(body));assert.equal(response.status,200);const result=await response.json();
  assert.match(result.url,/^https:\/\/biocamisas\.shop\/cartao\/[a-f0-9-]+$/);
  assert.deepEqual(await (await orders.POST(req(body))).json(),result);
  assert.equal((await (await orders.POST(req(body,bravus))).json()).url,result.url.replace(bio,bravus));
  assert.equal(db.prepare("SELECT count(*) AS n FROM payment_orders WHERE provider='beehive_card'").get().n,1);assert.equal(posts,1);
});

test('as mensagens públicas escondem o provedor que gera o pagamento',()=>{
  const samples=['A Beehive encontrou o pedido com status paid.','A Beehive não confirmou o PIX. O resultado pode ter mudado; confira o extrato antes de gerar outro.','A Atlas recusou a autenticação ou a permissão de venda.','A Atlas encerrou esta cobrança com status expired. Confira no painel Atlas.','Não foi possível confirmar o PIX na Atlas. Tente recuperar o mesmo pedido.','Esta cobrança foi recusada ou encerrada. Confira o pedido no painel Atlas antes de iniciar outro.','Webhook Atlas não configurado.','BuckPay: HTTP 503 ao enviar o pedido. Nenhuma cobrança foi criada.','A consulta da BuckPay ainda não encontrou esta cobrança (HTTP 404). Confira no painel antes de iniciar outro pedido.','A BuckPay encontrou a cobrança pendente, mas a consulta não retornou o código PIX. Abra essa cobrança no painel BuckPay para recuperar o código.','Não foi possível consultar e validar a cobrança anterior na BuckPay. Nenhuma nova cobrança foi enviada.','A Eleva recusou os dados deste pedido. Confira os dados e inicie outro pedido.','Este pedido já foi enviado. Confira no painel Firebot antes de iniciar outra cobrança; o resultado ainda não pôde ser confirmado.','A Firebot não confirmou o resultado da solicitação. Confira no painel Firebot antes de iniciar outro pedido para evitar cobrança duplicada.','A Gestão Pay não retornou o identificador desta cobrança. Confira o pedido manualmente no painel Gestão Pay antes de iniciar outro.','A cobrança não está pendente na Gestão Pay. Confira o status no painel.','Não foi possível recuperar o PIX da Gestão Pay. Nenhuma nova cobrança foi enviada.','Gestão Pay: HTTP 408. Nenhuma cobrança foi criada.','Não foi possível concluir o PIX da Gestão Pay','A Poseidon não confirmou o resultado da solicitação. Confira no painel Poseidon antes de iniciar outro pedido para evitar cobrança duplicada.','As credenciais BuckPay já estão configuradas e bloqueadas para alteração.'];
  for(const s of samples){const masked=mask.maskGateway(s);for(const name of ['Beehive','Atlas','Eleva','Gestão Pay','Poseidon','BuckPay','Firebot'])assert.ok(!masked.includes(name),masked+' <= '+s);}
  assert.equal(mask.maskGateway('A Atlas encerrou esta cobrança com status expired. Confira no painel Atlas.'),'O fornecedor encerrou esta cobrança com status expired. Confira no painel.');
  assert.equal(mask.maskGateway('A Beehive não confirmou o PIX.'),'O fornecedor não confirmou o PIX.');
  assert.equal(mask.maskGateway('Gestão Pay: HTTP 408. Nenhuma cobrança foi criada.'),'Fornecedor: HTTP 408. Nenhuma cobrança foi criada.');
  assert.equal(mask.maskGateway(undefined),'');
  assert.equal(mask.maskGateway('PIX gerado com sucesso.'),'PIX gerado com sucesso.');
});

test('PIX Bio Camisas usa o cadastro da marca e clientes sem cadastro podem completar os dados no mesmo pedido',async()=>{
  await payments.saveCredentials('fake-beehive-secret','fake-public-key','beehive');
  await gateways.selectGateway('beehive');
  const names=await load('lib/checkout-buyer-names.ts','checkout-buyer-names');
  const preset=await load('lib/biocamisas-customer.ts','server-buyer-preset');
  const send=(body,host=bio)=>{
    const request=req(body,host);
    request.headers.set('cf-connecting-ip','192.0.2.14');
    return orders.POST(request);
  };
  const outgoing=[];
  globalThis.fetch=async (url,init)=>{
    assert.equal(url,'https://api.conta.paybeehive.com.br/v1/transactions');
    assert.equal(init.method,'POST');
    const payload=JSON.parse(init.body);
    outgoing.push(payload);
    return Response.json({id:1000+outgoing.length,amount:payload.amount,paymentMethod:'pix',
      status:'waiting_payment',externalRef:payload.externalRef,pix:{qrcode:'000201-pix-simulado'}});
  };
  const branded={amount:15000,requestId:crypto.randomUUID(),customer:{name:names.BIOCAMISAS_BUYER_NAME}};
  const wrongBrand=await send({...branded,checkoutOrigin:bio},bravus);
  assert.equal(wrongBrand.status,400);
  assert.equal((await wrongBrand.json()).code,'BUYER_DETAILS_REQUIRED');
  assert.equal(outgoing.length,0);
  const result=await send(branded);
  assert.equal(result.status,200);
  assert.match((await result.json()).url,/^https:\/\/biocamisas\.shop\/pagar\//);
  const brandedBuyer=preset.biocamisasCustomer('biocamisas',names.BIOCAMISAS_BUYER_NAME);
  assert.equal(outgoing[0].customer.document.number,brandedBuyer.cpf);
  assert.equal(outgoing[0].customer.email,brandedBuyer.email);

  const manual={amount:10987,requestId:crypto.randomUUID(),customer:{name:'Comprador de teste'}};
  const missing=await send(manual,bravus);
  assert.equal(missing.status,400);
  assert.equal((await missing.json()).code,'BUYER_DETAILS_REQUIRED');
  assert.equal(db.prepare('SELECT id FROM payment_orders WHERE request_id=?').get(manual.requestId),undefined);
  assert.equal(outgoing.length,1);
  const complete={...manual,customerMode:'manual',customer:{name:manual.customer.name,email:'buyer@example.test',cpf:'52998224725',phone:'11999999999'}};
  const invalid=await send({...complete,customer:{...complete.customer,phone:''}},bravus);
  assert.equal(invalid.status,400);
  assert.equal(outgoing.length,1);
  const first=await send(complete,bravus);assert.equal(first.status,200);
  assert.deepEqual(await (await send(complete,bravus)).json(),await first.json());
  assert.equal(outgoing.length,2);
  assert.equal(outgoing[1].externalRef,manual.requestId);
  assert.equal(outgoing[1].customer.email,complete.customer.email);
  assert.equal((await send({...complete,customer:{...complete.customer,name:'Outro comprador'}},bravus)).status,400);
  assert.equal(outgoing.length,2);
});

test('o mesmo cadastro das duas marcas funciona nas integrações PIX sem perder o vendedor',async()=>{
  const names=await load('lib/checkout-buyer-names.ts','company-buyer-names');
  const bioProfile=await load('lib/biocamisas-customer.ts','company-buyer-bio');
  const bee=await load('lib/beehive.ts','company-buyer-registry');
  const bravusBuyer={name:names.BRAVUS_BUYER_NAME,email:'empresa@example.test',cpf:'52998224725',phone:'11999999999'};
  await bee.configureBeehiveCustomer(bravusBuyer);
  const companies=[[bravus,bravusBuyer],[bio,bioProfile.biocamisasCustomer('biocamisas',names.BIOCAMISAS_BUYER_NAME)]];
  const scenarios=[
    {provider:'buckpay',phone:false,identity:false,wire:p=>p.buyer,reply:(p,id)=>({data:{total_amount:p.amount,pix:{code:'000201-fixture',qrcode_base64:'aGVsbG8='}}})},
    {provider:'firebot',phone:false,identity:false,wire:p=>p.customer,reply:(p,id)=>({success:true,amount:p.amount,transactionId:id,pixCopiaECola:'000201-fixture'})},
    {provider:'eleva',phone:false,identity:true,wire:p=>({name:p.payer_name,email:p.payer_email}),reply:(p,id)=>({success:true,data:{transaction_uuid:id,amount:p.amount,status:'pending',pix_code:'000201-fixture'}})},
    {provider:'gestao',phone:true,identity:true,wire:p=>p.customer,reply:(p,id)=>({success:true,data:{id,amount:p.amount,payment_method:'pix',pix:{qr_code:'000201-fixture'}}})},
    {provider:'poseidon',phone:true,identity:true,wire:p=>p.client,reply:(p,id)=>({transactionId:id,status:'OK',pix:{code:'000201-fixture'}})},
  ];
  for(const {provider,phone,identity,wire,reply} of scenarios){
    await payments.saveCredentials('provider-fixture-only','agent-fixture',provider);
    await gateways.selectGateway(provider);
    const config=await (await settings.GET(new Request(bravus+'/api/settings?requirements=1'))).json();
    assert.equal(config.buyerRequirements.bravusCompanyAvailable,true,provider);
    assert.equal(config.buyerRequirements.buyerDetailsRequired,identity,provider);
    assert.equal(config.buyerRequirements.phoneRequired,phone,provider);
    let outbound=0;
    for(const [origin,buyer] of companies){
      globalThis.fetch=async (_url,init)=>{
        assert.equal(init.method,'POST');
        const payload=JSON.parse(init.body),customer=wire(payload);
        assert.equal(customer.name,buyer.name,provider);
        if(identity)assert.ok(customer.email===buyer.email,provider+' sends the configured e-mail');
        else assert.deepEqual(Object.keys(customer),['name']);
        outbound++;
        return Response.json(reply(payload,'fixture-'+crypto.randomUUID()));
      };
      const body={provider,requestId:crypto.randomUUID(),amount:18910,sellerName:'Vendedor de teste',customerMode:'company',customer:{name:buyer.name}};
      const created=await orders.POST(req(body,origin));
      assert.equal(created.status,200,provider);
      const paid=await created.json();
      assert.ok(paid.url.startsWith(origin+'/pagar/'),provider);
      const row=db.prepare('SELECT seller_name,provider FROM payment_orders WHERE request_id=?').get(body.requestId);
      assert.equal(row.seller_name,body.sellerName);
      assert.equal(row.provider,provider);
      const recovery=await orders.POST(req(body,origin));
      assert.equal(recovery.status,200);
      assert.deepEqual(await recovery.json(),paid);
    }
    assert.equal(outbound,companies.length,provider+' emits one charge per order');
  }
});

test.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
