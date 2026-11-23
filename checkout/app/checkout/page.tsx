import Checkout from './ui';
import {panelUnlocked} from '@/lib/gateway-access';
import {currentCheckoutBrand} from '@/lib/checkout-context';
export const dynamic='force-dynamic';
export default async function Page(){return <Checkout canConfigure={await panelUnlocked()} brand={await currentCheckoutBrand()}/>}
