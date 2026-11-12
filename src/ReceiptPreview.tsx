import { Download, ExternalLink, FileText } from 'lucide-react';
import type { ReceiptView } from './receipts.ts';

export default function ReceiptPreview({ receipt, imageAlt }: { receipt: ReceiptView; imageAlt: string }) {
  if (receipt.mime !== 'application/pdf') return <img className="receipt-preview" src={receipt.url} alt={imageAlt} />;
  const filename = /\.pdf$/i.test(receipt.name) ? receipt.name : receipt.name + '.pdf';
  return <div className="pdf-receipt-preview" role="group" aria-label="Comprovante em PDF">
    <FileText size={44} aria-hidden="true" /><strong>{filename}</strong>
    <p>Abra o comprovante em outra guia ou baixe o PDF para conferir.</p>
    <div><a className="button primary" href={receipt.url} target="_blank" rel="noopener noreferrer" type="application/pdf"><ExternalLink size={16} />Abrir PDF</a>
      <a className="button secondary" href={receipt.url} download={filename} type="application/pdf"><Download size={16} />Baixar PDF</a></div>
  </div>;
}
