import html from '../../legacy/funnel3.html?raw';
import {serveFunnel} from '@/lib/funnel-access';
export const dynamic='force-dynamic';
export async function GET(req:Request){return serveFunnel(req,html,false);}
