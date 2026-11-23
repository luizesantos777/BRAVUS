import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const compiled=await build({stdin:{contents:`import {activatePoseidon} from './lib/poseidon';export default {async fetch(){try{return Response.json({configured:await activatePoseidon('test-public','test-secret')})}catch(e){return Response.json({code:e.code||'RUNTIME_ERROR'})}}}`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,plugins:[{name:'test-vault',setup(b){b.onResolve({filter:/^\.\/payments$/},()=>({path:'vault',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const PAYMENT_ORIGIN='https://pagamento.bravuspix.shop';export const saveCredentials=async()=>{};export const credentials=async()=>null;export const database=()=>null;export const json=Response.json;`,loader:'js'}));}}]});
let requests=0,redirect=false;
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],script:compiled.outputFiles[0].text,outboundService:request=>{
 requests++;assert.equal(request.url,'https://app.poseidonpay.site/api/v1/gateway/producer/credentials');
 assert.equal(request.headers.get('x-public-key'),'test-public');assert.equal(request.headers.get('x-secret-key'),'test-secret');
 return redirect?new Response(null,{status:307,headers:{location:'https://other.example.test/'}}):Response.json({name:'Test credential',permissions:['PRODUCER_TRANSACTIONS'],grantAllPermissions:false,expiresAt:null});
}});
try{
 assert.deepEqual(await (await mf.dispatchFetch('http://localhost')).json(),{configured:true});assert.equal(requests,1);
 redirect=true;
 assert.deepEqual(await (await mf.dispatchFetch('http://localhost')).json(),{code:'UNEXPECTED_REDIRECT'});assert.equal(requests,2);
 console.log('Passed in Workers runtime: authentication fetch works; redirects never forward credentials.');
}finally{await mf.dispose()}
