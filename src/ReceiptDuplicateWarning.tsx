import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { dateLabel, money, saleStatusLabel } from './domain.ts';
import type { AdminSale } from './domain.ts';

export default function ReceiptDuplicateWarning({ sale }: { sale: AdminSale }) {
  const [expanded, setExpanded] = useState(false);
  const duplicates = sale.receiptDuplicates;
  if (!duplicates?.total) return null;
  return <aside className="receipt-duplicate-warning" aria-label="Alerta de comprovante repetido"><div><AlertCircle size={17} /><strong>Possível venda duplicada</strong></div>
    <p>Este mesmo print aparece em {duplicates.total} outro(s) lançamento(s). Confira as vendas relacionadas antes de aprovar.</p>
    <button type="button" className="button secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Ocultar lançamentos relacionados' : 'Conferir lançamentos relacionados'}</button>
    {expanded && <><ul>{duplicates.matches.map(match => <li key={match.id}><strong>{match.attendantName}</strong> · {dateLabel(match.date)} às {match.time} · {money(match.amountCents)} · {saleStatusLabel(match)}</li>)}</ul>{duplicates.total > duplicates.matches.length && <p>Exibindo {duplicates.matches.length} lançamentos relacionados.</p>}</>}
  </aside>;
}
