import {preserveGatewaySelection} from '@/lib/gateways';
import {panelGuard} from '@/lib/gateway-access';
import {credentials,json,readBody} from '@/lib/payments';
import {activateBeehive} from '@/lib/beehive';
export const dynamic='force-dynamic';
export async function GET(req:Request){const deny=await panelGuard(req);if(deny)return deny;try{return json({configured:!!await credentials('beehive')});}catch{return json({error:'Não foi possível consultar a configuração.'},503);}}
export async function POST(req:Request){const deny=await panelGuard(req);if(deny)return deny;try{
 const b=await readBody(req),token=typeof b.token==='string'?b.token.trim():'',publicKey=b.publicKey===undefined?(await credentials('beehive'))?.agent||'':typeof b.publicKey==='string'?b.publicKey.trim():'';
 if(token.length<10||token.length>1024||/[^\x21-\x7e]/.test(token)||token.startsWith('pk_')||publicKey.length>1024)return json({error:'Informe a chave secreta da Beehive. A chave pública não autentica a API.'},400);
 if(b.activate===false)await preserveGatewaySelection();await activateBeehive(token,publicKey);return json({configured:true});
 }catch{return json({error:'A Beehive não confirmou a chave secreta ou a empresa. Confira a chave, a validade e as permissões. A configuração anterior foi preservada.'},503);}}
