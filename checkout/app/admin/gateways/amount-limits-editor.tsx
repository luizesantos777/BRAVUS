'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseCheckoutAmount } from '@/lib/checkout-amount';
import type { GatewayAmountLimits } from '@/lib/gateway-amount-limits';
import { decimal } from './cost-editor';

type Method = keyof GatewayAmountLimits;
type AmountFields = { minimum: string; maximum: string };
type Draft = Record<Method, AmountFields>;

const methodLabels: Record<Method, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de crédito',
};

function fields(limits: GatewayAmountLimits[Method] | undefined): AmountFields {
  return {
    minimum: limits?.minCents == null ? '' : decimal(limits.minCents),
    maximum: limits?.maxCents == null ? '' : decimal(limits.maxCents),
  };
}

function readLimits(method: Method, values: AmountFields): GatewayAmountLimits[Method] {
  function read(value: string, label: string) {
    if (!value.trim()) return null;
    const cents = parseCheckoutAmount(value.trim());
    if (cents === null) {
      throw Error(`Informe um valor ${label} válido em reais para ${methodLabels[method]}.`);
    }
    return cents;
  }

  const minCents = read(values.minimum, 'mínimo');
  const maxCents = read(values.maximum, 'máximo');
  if (minCents !== null && maxCents !== null && minCents > maxCents) {
    throw Error(`O valor máximo de ${methodLabels[method]} deve ser igual ou superior ao mínimo.`);
  }
  return minCents === null && maxCents === null ? null : { minCents, maxCents };
}

export default function AmountLimitsEditor({ provider, name, initial, busy, onBusy, onSaved }: {
  provider: string;
  name: string;
  initial?: GatewayAmountLimits | null;
  busy: boolean;
  onBusy: (value: string) => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const values = draft ?? { pix: fields(initial?.pix), credit_card: fields(initial?.credit_card) };
  const methods: Method[] = provider === 'beehive' ? ['pix', 'credit_card'] : ['pix'];
  const configured = methods.some(method => initial?.[method]);

  function edit(method: Method, bound: keyof AmountFields, value: string) {
    setDraft({ ...values, [method]: { ...values[method], [bound]: value } });
    setError('');
    setNotice('');
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    let amountLimits: GatewayAmountLimits;
    try {
      amountLimits = {
        pix: readLimits('pix', values.pix),
        credit_card: provider === 'beehive' ? readLimits('credit_card', values.credit_card) : null,
      };
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    onBusy('amount-limits:' + provider);
    try {
      const response = await fetch('/api/admin/gateways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'amount-limits', provider, amountLimits }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Não foi possível salvar os limites de pagamento.');
      await onSaved();
      setDraft(null);
      setNotice('Limites salvos para novos pagamentos.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      onBusy('');
    }
  }

  return <details className="gateway-cost-editor">
    <summary>{configured ? 'Editar limites de pagamento' : 'Limites de pagamento · não informados'}</summary>
    <form onSubmit={save}>
      <p className="field-note">Preencha com os valores confirmados na sua conta da gateway. Campos vazios ficam sem limite cadastrado.</p>
      <fieldset disabled={busy}>
        <legend className="sr-only">Limites de pagamento de {name}</legend>
        {methods.map(method => <fieldset key={method}>
          <legend>{methodLabels[method]}</legend>
          {method === 'credit_card' && <p className="field-note">Use o total cobrado no cartão, incluindo os acréscimos do parcelamento.</p>}
          <div className="gateway-cost-fields">
            <label className="field"><span>Mínimo (R$)</span><Input aria-label={`Valor mínimo de ${methodLabels[method]} em ${name}`} value={values[method].minimum} inputMode="decimal" onChange={event => edit(method, 'minimum', event.target.value)} /></label>
            <label className="field"><span>Máximo (R$)</span><Input aria-label={`Valor máximo de ${methodLabels[method]} em ${name}`} value={values[method].maximum} inputMode="decimal" onChange={event => edit(method, 'maximum', event.target.value)} /></label>
          </div>
        </fieldset>)}
        <Button type="submit" className="action">Salvar limites de {name}</Button>
      </fieldset>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
  </details>;
}
