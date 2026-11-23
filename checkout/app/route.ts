import html from '../legacy/funnel.html?raw';
import {serveFunnel} from '@/lib/funnel-access';
import {checkoutBrandForRequest} from '@/lib/checkout-brand';
export const dynamic='force-dynamic';
export async function GET(req:Request){const brand=checkoutBrandForRequest(req);if(brand.id==='biocamisas')return new Response(null,{status:302,headers:{Location:brand.origin+'/checkout','Cache-Control':'no-store'}});return serveFunnel(req,html,false);}
