import {login,loginPage} from '@/lib/funnel-access';
export const dynamic='force-dynamic';
export const POST=login;

export function GET(){return loginPage();}
