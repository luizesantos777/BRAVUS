import {panelGuard} from '@/lib/gateway-access';
import {json,readBody} from '@/lib/payments';
import {configureBeehiveCustomer} from '@/lib/beehive';
import {InputError} from '@/lib/firebot';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const deny=await panelGuard(req);if(deny)return deny;
 try{
  const body=await readBody(req);
  if(!body?.customer||typeof body.customer!=='object'||Array.isArray(body.customer))return json({error:'Preencha o cadastro do cliente.'},400);
  await configureBeehiveCustomer(body.customer);
  return json({saved:true});
 }catch(error){return error instanceof InputError?json({error:error.message},400):json({error:'Não foi possível salvar o cadastro. Tente novamente.'},503);}
}
