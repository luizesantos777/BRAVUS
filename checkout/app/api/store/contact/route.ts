import {database,json,readBody} from '@/lib/payments';
import {ownerPanelGuard as panelGuard} from '@/lib/gateway-access';
export const dynamic='force-dynamic';
export async function GET(){try{const row=await database().prepare('SELECT value FROM payment_settings WHERE key=?').bind('store_whatsapp').first();return json({phone:row?.value||'5511925585852'});}catch{return json({phone:'5511925585852'})}}
export async function POST(req:Request){const deny=await panelGuard(req);if(deny)return deny;try{const b=await readBody(req);if(typeof b.phone!=='string'||!/^55[1-9]\d{9,10}$/.test(b.phone))return json({error:'Informe 55, DDD e número do WhatsApp da Bravus.'},400);await database().prepare('INSERT INTO payment_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('store_whatsapp',b.phone).run();return json({ok:true});}catch{return json({error:'Não foi possível salvar o WhatsApp.'},503)}}
