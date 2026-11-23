import type {Metadata,Viewport} from 'next';
import './globals.css';
import {currentCheckoutBrand} from '@/lib/checkout-context';
export async function generateMetadata():Promise<Metadata>{const brand=await currentCheckoutBrand();return {title:brand.name+' · Pagamento seguro',description:'Pagamento do seu pedido '+brand.name+' com PIX ou cartão.',robots:{index:false,follow:false}};}
export const viewport:Viewport={width:'device-width',initialScale:1};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
