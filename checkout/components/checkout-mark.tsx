import type { CheckoutBrand } from '@/lib/checkout-brand';

export default function CheckoutMark({ brand }: { brand: CheckoutBrand }) {
  return brand.id === 'biocamisas'
    ? <img src="/assets/bio-camisas-logo.png" alt={brand.name} />
    : <img src="/assets/bravus-logo.jpg" alt={brand.name} />;
}
