import code from '../../legacy/funnel4.js?raw';
import {serveFunnel} from '@/lib/funnel-access';
export const dynamic='force-dynamic';
export async function GET(req:Request){return serveFunnel(req,code,true);}
