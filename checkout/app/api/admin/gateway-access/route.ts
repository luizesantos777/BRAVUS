import {guard,publicGuard,isOwner,json,readBody,database} from '@/lib/payments';
import {passwordRecord,panelUnlocked,setPanelPassword,checkPassword,sessionCookie,claimPasswordAttempt,COOKIE} from '@/lib/gateway-access';
export const dynamic='force-dynamic';
export async function GET(req:Request){const deny=await publicGuard(req);if(deny)return deny;try{return json({configured:!!await passwordRecord(),canSetup:await isOwner(),unlocked:await panelUnlocked()});}catch{return json({error:'Não foi possível carregar o acesso.'},503);}}
export async function POST(req:Request){const deny=await publicGuard(req);if(deny)return deny;try{
 const b=await readBody(req);if(typeof b.password!=='string'||b.password.length<8||b.password.length>128)return json({error:'Use uma senha com 8 a 128 caracteres.'},400);
 let record=await passwordRecord();
 if(!await claimPasswordAttempt())return json({error:'Muitas tentativas. Aguarde 15 minutos para tentar novamente.'},429);
 if(!record){const setupDenied=await guard(req);if(setupDenied)return setupDenied;if(b.action!=='setup')return json({error:'Defina a senha primeiro.'},409);record=await setPanelPassword(b.password);}
 else if(!await checkPassword(b.password,record))return json({error:'Senha incorreta.'},401);
 await database().prepare('DELETE FROM payment_settings WHERE key=?').bind('gateway_login_attempts').run();const r=json({unlocked:true});r.headers.set('Set-Cookie',await sessionCookie(record));return r;
 }catch{return json({error:'Não foi possível desbloquear o painel. Tente novamente.'},503);}}
export async function DELETE(req:Request){const deny=await publicGuard(req);if(deny)return deny;const r=json({unlocked:false});r.headers.set('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return r;}
