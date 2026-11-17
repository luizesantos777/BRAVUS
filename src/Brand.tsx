import { ShieldCheck, TrendingUp, Zap } from 'lucide-react';
import type { AccountKind } from './domain.ts';
import { publicAssetUrl } from './pwa.ts';
export const brandImage = publicAssetUrl('lucro-certo-wolf.svg');
export function Brand() {
  return <span className="brand-lockup"><img className="brand-emblem" src={brandImage} alt="" width="64" height="64" /><span className="brand-wordmark"><strong>LUCRO CERTO <em>PAY</em></strong><small>INSTINTO PARA CRESCER.</small></span></span>;
}
export function BrandIntro({ accountKind }: { accountKind?: AccountKind }) {
  return <section className="brand-intro" aria-label="Lucro Certo Pay"><div className="brand-intro-content"><span className="brand-eyebrow"><i />LUCRO CERTO PAY</span><h1>{accountKind === 'partner' ? 'Portal do Parceiro' : 'Portal do Atendente'}<span>.</span></h1><p>Seu próximo resultado começa aqui. Acompanhe vendas, saldo e repasses.</p><div className="brand-sectors"><span><TrendingUp size={15} />Performance</span><span><ShieldCheck size={16} />Controle</span><span><Zap size={15} />Agilidade</span></div></div><img className="brand-intro-image" src={brandImage} alt="Lobo Lucro Certo Pay" width="192" height="192" fetchPriority="high" /></section>;
}
