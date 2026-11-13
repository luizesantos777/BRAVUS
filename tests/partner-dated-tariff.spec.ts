import { expect, test } from '@playwright/test';
const adminKey='fixture_browser_admin_012345678901234567890123456789';
const receipt={name:'data.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII='};

test('parceiro vê a prévia da data correta e o admin distingue a tarifa atual do histórico misto',async({page},info)=>{
 const token=`fixture_${info.project.name}_dated_tariff_01234567890123456789`,personal={Authorization:'Bearer '+token},admin={Authorization:'Bearer '+adminKey};
 await page.goto('/#/atendente/'+token);await expect(page.getByRole('heading',{name:'Portal do Parceiro.',exact:true})).toBeVisible();
 await page.getByLabel('Valor bruto venda 1',{exact:true}).fill('100');
 const date=page.getByLabel('Data da Venda',{exact:false}),preview=page.getByLabel('Resumo da venda 1',{exact:true});
 await date.fill('2026-11-12');await expect(preview).toContainText('86,00');
 await date.fill('2026-11-13');await expect(preview).toContainText('84,00');
 for(const d of ['2026-11-12','2026-11-13']){
  const response=await page.request.post('/api/sales',{headers:{...personal,'Idempotency-Key':`fixture_dated_browser_${info.project.name}_${d}`},data:{date:d,sales:[{amount:'100',time:'12:00',note:'Tarifa vigente',receipt}]}});expect(response.status()).toBe(200);
 }
 const portal=await (await page.request.get('/api/portal?period=all',{headers:personal})).json();
 expect(portal.sales.find((s:{date:string})=>s.date==='2026-11-12').feeCents).toBe(1400);expect(portal.sales.find((s:{date:string})=>s.date==='2026-11-13').feeCents).toBe(1600);
 for(const sale of portal.sales){const response=await page.request.patch('/api/admin/sales/'+sale.id,{headers:admin,data:{status:'approved',note:'Conferência de teste'}});expect(response.status()).toBe(200);}
 await page.goto('/#/admin');await page.getByLabel('Chave administrativa').fill(adminKey);await page.getByRole('button',{name:'Entrar na administração',exact:true}).click();await expect(page.getByRole('heading',{name:'Visão administrativa',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Repasses',exact:true}).click();await page.getByLabel('Atendente dos saldos',{exact:true}).selectOption(portal.profile.id);
 const card=page.locator('.attendant-balance').filter({has:page.getByRole('heading',{name:`Parceiro tarifa por data ${info.project.name}`,exact:true})});
 await expect(card.locator('.checkout-tariff')).toContainText('14%');await expect(card.locator('.checkout-tariff')).toContainText('13/11/2026');
 const value=(label:string)=>card.locator('dl > div').filter({has:page.locator('dt').filter({hasText:label})}).locator('dd');
 await expect(value('Taxas das vendas (conforme a data)')).toContainText('30,00');await expect(value('Valor do parceiro após as taxas de venda')).toContainText('170,00');await expect(value('Lucro BRAVUS nas taxas')).toContainText('14,04');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
