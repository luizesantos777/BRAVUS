import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {stripTypeScriptTypes} from 'node:module';
const moduleURL=code=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64');
const coreURL=moduleURL(readFileSync('lib/funnel-session.ts','utf8'));
const core=await import(coreURL);
const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE payment_settings (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL)');
let failures=0,calls=0,permanent=false;
globalThis.__funnelTestEnv={FUNNEL_AUTH:JSON.stringify({salt:'salt',hash:await core.digest('test-password','salt'),sessionKey:'test-session-key'})};
globalThis.__funnelTestDB={prepare:sql=>({bind:(...args)=>({run:async()=>{
 calls++;
 if(permanent)throw Error('D1_ERROR: no such table');
 if(failures>0){failures--;throw Error('D1_ERROR: internal error; reference = synthetic');}
 return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};
}})})};
const source=readFileSync('lib/funnel-access.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.__funnelTestEnv;').replace("import {database} from './payments';",'const database=()=>globalThis.__funnelTestDB;').replace("'./funnel-session'",JSON.stringify(coreURL));
const {serveFunnel,login}=await import(moduleURL(source));
const origin='https://pagamento.bravuspix.shop';
for(const path of core.funnelPaths){const r=await serveFunnel(new Request(origin+path),'PRIVATE FUNNEL');assert.equal(r.status,200);assert.match(await r.text(),/Acesso ao funil/);assert.match(r.headers.get('Cache-Control'),/no-store/);}
assert.equal((await serveFunnel(new Request(origin+'/funnel.js'),'SECRET SCRIPT',true)).status,401);
const request=(password,extra={},requestOrigin=origin)=>new Request(origin+'/api/funnel-access',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password,returnTo:'/funil-3',...extra})});
assert.equal((await login(request('wrong'))).status,401);
assert.equal((await login(request('test-password',{},'https://evil.invalid'))).status,403);
// Regression: browsers sending a form from the previous no-referrer login page
// report Origin: null but retain trustworthy same-origin Fetch Metadata.
const opaqueRequest=(site,withOrigin=true)=>new Request(origin+'/api/funnel-access',{method:'POST',headers:{...(withOrigin?{Origin:'null'}:{}),'Sec-Fetch-Site':site,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:'test-password'})});
assert.equal((await login(opaqueRequest('same-origin'))).status,303);
assert.equal((await login(opaqueRequest('same-origin',false))).status,303);
assert.equal((await login(opaqueRequest('cross-site'))).status,403);
assert.equal((await login(opaqueRequest('same-site'))).status,403);
assert.equal((await login(opaqueRequest(''))).status,403);
assert.equal((await serveFunnel(new Request(origin+'/'),'PRIVATE')).headers.get('Referrer-Policy'),'same-origin');
const ok=await login(request('test-password'));assert.equal(ok.status,303);assert.equal(ok.headers.get('Location'),'/funil-3');
const cookie=ok.headers.get('Set-Cookie');for(const attr of ['HttpOnly','Secure','SameSite=Strict'])assert.ok(cookie.includes(attr));
assert.equal(await (await serveFunnel(new Request(origin+'/',{headers:{Cookie:cookie}}),'PRIVATE FUNNEL')).text(),'PRIVATE FUNNEL');
assert.equal(await (await serveFunnel(new Request(origin+'/funnel.js',{headers:{Cookie:cookie}}),'SCRIPT',true)).text(),'SCRIPT');
assert.equal((await login(request('test-password',{returnTo:'https://evil.invalid'}))).headers.get('Location'),'/');
const logout=await login(request('',{action:'logout'}));assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);
for(let i=0;i<10;i++)await login(request('wrong'));
assert.equal((await login(request('test-password'))).status,429);
// Expired limits reset; transient D1 failures recover without bypassing auth.
sqlite.exec("UPDATE payment_settings SET value='{\"until\":0,\"count\":10}'");
failures=2;calls=0;
assert.equal((await login(request('test-password'))).status,303);
assert.equal(calls,3);
failures=1;
assert.equal((await login(request('wrong'))).status,401);
failures=3;calls=0;
assert.equal((await login(request('test-password'))).status,503);
assert.equal(calls,3);
failures=0;permanent=true;calls=0;
assert.equal((await login(request('test-password'))).status,503);
assert.equal(calls,1);
permanent=false;
delete globalThis.__funnelTestEnv.FUNNEL_AUTH;
assert.equal((await serveFunnel(new Request(origin+'/'),'PRIVATE')).status,503);
console.log('Funnel HTTP checks passed: protected pages and scripts, valid/invalid login, origin, redirects, cookies, logout, rate limit and fail-closed.');
