import CardPayment from './ui';
import {currentCheckoutBrand} from '@/lib/checkout-context';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){return <CardPayment id={(await params).id} brand={await currentCheckoutBrand()}/>}
