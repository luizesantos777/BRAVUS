import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PortalStore } from '../server/store.ts';
import { libsqlDatabase } from '../server/turso-database.ts';
import { createArchive, restoreArchive } from '../server/backups.ts';
import { REQUESTED_PARTNER_TARIFF } from '../server/partner-tariff-migration.ts';
import { accountCheckouts, businessToday, checkoutFee, PARTNER_CHECKOUT, partnerTariffAt, saleEarnings } from '../src/domain.ts';
import { readFinancialReport } from '../server/admin-controls.ts';
const receipt={name:'fixture.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII='};
const input=(date:string,amount='100')=>({date,sales:[{amount,checkoutId:'main',time:'12:00',note:'Venda sintética',receipt}]});
const rules=[{effectiveFrom:'2026-11-13',feeBps:1400,fixedFeeCents:200}];

test('data brasileira de vigência mantém o padrão antes do dia 13 e calcula 14% + R$ 2 por venda depois',()=>{
 assert.equal(businessToday(new Date('2026-11-13T02:59:59Z')),'2026-11-12');assert.equal(businessToday(new Date('2026-11-13T03:00:00Z')),'2026-11-13');
 assert.equal(checkoutFee(10000,accountCheckouts([], 'partner',rules,'2026-11-12')[0]),1400);
 assert.equal(checkoutFee(10000,accountCheckouts([], 'partner',rules,'2026-11-13')[0]),1600);
 assert.equal(checkoutFee(21900,accountCheckouts([], 'partner',rules,'2026-11-13')[0]),3266);
 assert.equal(checkoutFee(10000,PARTNER_CHECKOUT),1400);
 assert.equal(partnerTariffAt([...rules,{effectiveFrom:'2026-12-01',feeBps:1700,fixedFeeCents:200}],'2026-11-20').feeBps,1400);
});

for(const driver of ['sqlite','libsql'] as const)test(driver+': migração isola Parceiro, mantém dias anteriores e PIX pagos, atualiza o dia 13 e é idempotente',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bravus-dated-rate-')),path=join(dir,'portal.sqlite');
 const open=()=>driver==='sqlite'?PortalStore.open(path):PortalStore.open(libsqlDatabase(createClient({url:'file:'+path,intMode:'number'})));
 let store=await open();
 try{
  const partner=await store.createPartner('Parceiro'),other=await store.createPartner('Parceiro 2'),attendant=await store.createAttendant('Atendente',5000);
  await store.sql.prepare('UPDATE attendants SET created_at=? WHERE id=?').run('2026-11-01T12:00:00.000Z',partner.id);
  await store.saveProfile({id:partner.id},{name:'Parceiro',email:'',phone:'',pixType:'email',pixKey:'fixture@example.test',pixOwner:'Parceiro'});
  await store.recordSales({id:partner.id},input('2026-11-12'),'fixture_dated_previous');
  await store.recordSales({id:partner.id},input('2026-11-13'),'fixture_dated_current');
  await store.recordSales({id:partner.id},input('2026-11-13','219'),'fixture_dated_pending');
  await store.recordSales({id:partner.id},input('2026-11-13','20'),'fixture_dated_rejected');
  const initial=await store.sales({id:partner.id});
  for(const sale of initial.filter(s=>s.amountCents===10000))await store.reviewSale(sale.id,{status:'approved',note:'Conferida'});
  await store.reviewSale(initial.find(s=>s.amountCents===2000)!.id,{status:'rejected',note:'Recusa original'});
  await store.recordManualPayout({attendantId:partner.id,amount:'10',note:'Transferência anterior'},'fixture_dated_payout');
  await store.setCosts(partner.id,'2026-11-13',700,0);
  for(const a of [other,attendant])await store.recordSales({id:a.id},input('2026-11-13'),'fixture_dated_other_'+a.id);
  const before=await store.sql.prepare('SELECT * FROM sales ORDER BY id').all();
  const payments=await store.payouts({id:partner.id}),costs=await store.costs({id:partner.id}),others=await store.profile({id:other.id});
  // Simulate a database where the previous 16% migration already ran.
  await store.sql.prepare('UPDATE attendants SET partner_fee_rules=? WHERE id=?').run(JSON.stringify([{effectiveFrom:'2026-11-13',feeBps:1600,fixedFeeCents:200}]),partner.id);
  await store.sql.prepare('INSERT INTO schema_migrations VALUES (?)').run('named-parceiro-16-percent-from-2026-11-13-v1');
  store.close();store=await open();
  const after=await store.sql.prepare('SELECT * FROM sales ORDER BY id').all();
  for(const sale of before){const updated=after.find(row=>row.id===sale.id)!;if(sale.attendant_id!==partner.id||String(sale.date)<'2026-11-13'){assert.deepEqual(updated,sale);continue;}
   const fee=Number(sale.amount_cents)===10000?1600:Number(sale.amount_cents)===21900?3266:480;assert.equal(updated.fee_cents,fee);assert.equal(updated.attendant_fee_cents,fee);assert.deepEqual({...updated,fee_cents:sale.fee_cents,attendant_fee_cents:sale.attendant_fee_cents},{...sale});
  }
  assert.deepEqual(await store.payouts({id:partner.id}),payments);assert.deepEqual(await store.costs({id:partner.id}),costs);assert.deepEqual(await store.profile({id:other.id}),others);
  const profile=await store.profile({id:partner.id});assert.deepEqual(profile.partnerFeeRules,rules);
  await store.saveProfile({id:partner.id},{name:'Parceiro',email:'',phone:'',pixType:'email',pixKey:'fixture@example.test',pixOwner:'Parceiro',partnerFeeRules:[]});assert.deepEqual((await store.profile({id:partner.id})).partnerFeeRules,rules);
  const portal=await store.portal({id:partner.id},'all');assert.equal(portal.checkouts[0].feeBps,1400);assert.equal(portal.finance.commissionCents,8600+8400);assert.equal(portal.finance.availableCents,8600+8400-1000);
  const admin=(await store.adminDashboard()).attendants.find(a=>a.id===partner.id)!;assert.deepEqual(admin.partnerFeeRules,rules);assert.equal(admin.finance.transactionFeeCents,1400+1600);assert.equal(admin.business!.gatewayCostCents,1596);
  const report=await readFinancialReport(store,'2026-11-12','2026-11-13',partner.id);assert.equal(report.totals.gatewayFeeCents,3000);
  await store.recordSales({id:partner.id},input('2026-11-12'),'fixture_dated_backdated');await store.recordSales({id:partner.id},input('2026-11-13'),'fixture_dated_new');
  const sales=await store.sales({id:partner.id});assert.ok(sales.filter(s=>s.date==='2026-11-12').every(s=>s.feeCents===1400));assert.ok(sales.filter(s=>s.date==='2026-11-13'&&s.amountCents===10000).every(s=>s.feeCents===1600));assert.equal(saleEarnings(sales.find(s=>s.date==='2026-11-13'&&s.amountCents===10000)!),8400);
  const audit=await store.sql.prepare("SELECT * FROM audit_events WHERE action IN ('partner.tariff_changed','partner.dated_sale_repriced') ORDER BY id").all();assert.equal(audit.length,4);
  assert.ok(await store.sql.prepare('SELECT id FROM schema_migrations WHERE id=?').get(REQUESTED_PARTNER_TARIFF.migration));store.close();store=await open();assert.deepEqual(await store.sql.prepare("SELECT * FROM audit_events WHERE action IN ('partner.tariff_changed','partner.dated_sale_repriced') ORDER BY id").all(),audit);
  const recovered=await PortalStore.open(':memory:');try{await restoreArchive(await createArchive(store),recovered);assert.deepEqual((await recovered.profile({id:partner.id})).partnerFeeRules,rules);assert.deepEqual((await recovered.sales({id:partner.id})).map(row=>({...row})),(await store.sales({id:partner.id})).map(row=>({...row})));}finally{recovered.close();}
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('não escolhe entre nomes duplicados, não aplica a novos cadastros e não altera um atendente comum chamado Parceiro',async()=>{
 const store=await PortalStore.open(':memory:');
 try{
  const first=await store.createPartner('Parceiro'),second=await store.createPartner('Parceiro');
  for(const id of [first.id,second.id])await store.sql.prepare('UPDATE attendants SET created_at=? WHERE id=?').run('2026-11-01T00:00:00Z',id);
  const {applyRequestedPartnerTariff}=await import('../server/partner-tariff-migration.ts');await store.sql.transaction(db=>applyRequestedPartnerTariff(db));
  assert.deepEqual((await store.profile({id:first.id})).partnerFeeRules,[]);assert.deepEqual((await store.profile({id:second.id})).partnerFeeRules,[]);
  await store.sql.prepare('UPDATE attendants SET created_at=?').run('2026-11-13T12:00:00Z');await store.sql.transaction(db=>applyRequestedPartnerTariff(db));assert.deepEqual((await store.profile({id:first.id})).partnerFeeRules,[]);
  await store.createAttendant('Parceiro',5000);await store.sql.transaction(db=>applyRequestedPartnerTariff(db));assert.equal(await store.sql.prepare('SELECT id FROM schema_migrations WHERE id=?').get(REQUESTED_PARTNER_TARIFF.migration),undefined);
 }finally{store.close();}
});

test('falha no recálculo reverte taxa, auditoria e marcador; backup anterior sem a coluna nova continua recuperável',async()=>{
 const store=await PortalStore.open(':memory:');
 try{
  const p=await store.createPartner('Parceiro');await store.sql.prepare('UPDATE attendants SET created_at=? WHERE id=?').run('2026-11-01T00:00:00Z',p.id);await store.recordSales({id:p.id},input('2026-11-13'),'fixture_dated_atomic');
  const {applyRequestedPartnerTariff}=await import('../server/partner-tariff-migration.ts');await store.sql.exec("CREATE TRIGGER fixture_dated_failure BEFORE UPDATE ON sales BEGIN SELECT RAISE(ABORT,'fixture rollback');END;");
  await assert.rejects(store.sql.transaction(db=>applyRequestedPartnerTariff(db)),/fixture rollback/);assert.deepEqual((await store.profile({id:p.id})).partnerFeeRules,[]);assert.equal((await store.sales({id:p.id}))[0].feeCents,1400);assert.equal((await store.sql.prepare("SELECT count(*) AS n FROM audit_events WHERE action='partner.tariff_changed'").get())!.n,0);
  const archive=JSON.parse(gunzipSync(await createArchive(store)).toString());const accounts=archive.tables.find((t:{name:string})=>t.name==='attendants'),index=accounts.columns.indexOf('partner_fee_rules');accounts.columns.splice(index,1);for(const row of accounts.rows)row.splice(index,1);
  const restored=await PortalStore.open(':memory:');try{await restoreArchive(gzipSync(Buffer.from(JSON.stringify(archive))),restored);assert.deepEqual((await restored.profile({id:p.id})).partnerFeeRules,[]);}finally{restored.close();}
 }finally{store.close();}
});
