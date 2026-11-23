import {panelGuard} from '@/lib/gateway-access';
import {atlasDiagnostics} from '@/lib/atlas-errors';
import {json} from '@/lib/payments';
export const dynamic='force-dynamic';
export async function GET(req:Request){const denied=await panelGuard(req);if(denied)return denied;try{return json({errors:await atlasDiagnostics()});}catch{return json({error:'Não foi possível consultar os diagnósticos da Atlas.'},503);}}
