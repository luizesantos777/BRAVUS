import { Fish, Mountain, Tractor } from 'lucide-react';
import brandImage from './assets/bravus-brasil.webp?inline';

export { brandImage };

export function Brand() {
  return <span className="brand-lockup">
    <img className="brand-emblem" src={brandImage} alt="" width="64" height="64" />
    <span className="brand-wordmark">
      <strong>BRAVUS</strong>
      <span className="brand-country"><i />BRASIL<i /></span>
      <small>PESCA · AGRO · AVENTURA</small>
    </span>
  </span>;
}

export function BrandIntro() {
  return <section className="brand-intro" aria-label="BRAVUS Brasil">
    <div className="brand-intro-content">
      <span className="brand-eyebrow"><i />BRAVUS BRASIL</span>
      <h1>Portal do Atendente<span>.</span></h1>
      <p>Acompanhe suas vendas, comissões e repasses.</p>
      <div className="brand-sectors" aria-label="Pesca, Agro e Aventura">
        <span><Fish size={15} />Pesca</span>
        <span><Tractor size={16} />Agro</span>
        <span><Mountain size={15} />Aventura</span>
      </div>
    </div>
    <img className="brand-intro-image" src={brandImage} alt="Marca BRAVUS Brasil — Pesca, Agro e Aventura" width="192" height="192" fetchPriority="high" />
  </section>;
}
