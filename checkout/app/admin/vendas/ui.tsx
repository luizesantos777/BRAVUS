'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Row = {
  id: string; requestId: string; amount: number; state: string; provider: string;
  sellerName: string | null; partnerSlug: string | null; createdAt: number; originLabel: string;
};
type Summary = { totalCount: number; paidCount: number; paidAmountCents: number; testCount: number; testAmountCents: number; pendingCount: number };
type PartnerTotal = { partnerSlug: string | null; totalCount: number; paidCount: number; paidAmountCents: number };

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const when = (ts: number) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const STATE_OPTIONS = [
  ['', 'Todos os status'], ['pendente', 'Pendentes'], ['paid', 'Pagos'], ['test_paid', 'Pagos (teste)'],
  ['rejected', 'Recusados'], ['unconfirmed', 'Não confirmados'], ['failed', 'Falhas'], ['expired', 'Expirados'],
  ['refunded', 'Estornados'], ['chargeback', 'Chargeback'], ['cancelled', 'Cancelados'],
];

export default function Vendas() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [byPartner, setByPartner] = useState<PartnerTotal[]>([]);
  const [partners, setPartners] = useState<Array<{ slug: string; name: string; active: boolean }>>([]);
  const [configured, setConfigured] = useState<string | null>(null);
  const [from, setFrom] = useState(day(-29));
  const [to, setTo] = useState(day(0));
  const [partner, setPartner] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [webSecret, setWebSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const webUrlRef = useRef('');

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setError('');
    try {
      const qs = new URLSearchParams({ from, to });
      if (partner) qs.set('partner', partner);
      if (status) qs.set('status', status);
      const r = await fetch('/api/admin/vendas?' + qs.toString(), { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Falha ao carregar as vendas.');
      setRows(d.rows); setSummary(d.summary); setByPartner(d.byPartner || []); setConfigured(d.configured ?? null);
      if (d.configured && !webUrlRef.current) setWebUrl(d.configured);
      const p = await fetch('/api/admin/partners', { cache: 'no-store' });
      const pd = await p.json();
      if (p.ok) setPartners(pd.partners || []);
    } catch (e) { setError((e as Error).message); } finally { loading.current = false; }
  }, [from, to, partner, status]);

  useEffect(() => {
    load().catch(() => {});
    const timer = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { clearInterval(timer); window.removeEventListener('focus', load); };
  }, [load]);

  async function saveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      webUrlRef.current = webUrl.trim();
      const r = await fetch('/api/admin/vendas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webUrl.trim(), secret: webSecret }) });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Não foi possível salvar.');
      setWebSecret('');
      setNotice(d.configured ? 'Portal conectado. As vendas confirmadas serão enviadas para o endereço informado.' : 'Envio ao portal desativado.');
      load().catch(() => {});
    } catch (e2) { setError((e2 as Error).message); } finally { setBusy(false); }
  }

  const partnerName = (slug: string | null) => (slug ? partners.find(p => p.slug === slug)?.name ?? slug : 'Sem parceiro');

  return (
    <main className="pay-shell gateway-page">
      <header className="pay-brand">
        <img src="/assets/bravus-logo.jpg" alt="Bravus Brasil" />
        <div><strong>BRAVUS BRASIL</strong><small>Painel privado de pagamentos</small></div>
      </header>
      <nav className="admin-nav"><a href="/admin/gateways">Gateways</a><a href="/admin/vendas" className="active">Vendas</a><a href="/admin/partners">Parceiros</a></nav>
      <div className="gateway-page-title"><div><h1>Vendas</h1><p className="muted">Compra confirmada aparece aqui automaticamente, sem lançamento manual. Atualiza a cada 30 segundos.</p></div></div>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="success">{notice}</p>}

      <section className="inline-form pay-card" style={{ marginBottom: '1rem' }}>
        <label className="field" style={{ marginBottom: 0 }}><span>De</span><Input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label className="field" style={{ marginBottom: 0 }}><span>Até</span><Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <label className="field" style={{ marginBottom: 0 }}><span>Parceiro</span>
          <select className="method-select" value={partner} onChange={e => setPartner(e.target.value)}>
            <option value="">Todos</option>
            {partners.map(p => <option key={p.slug} value={p.slug}>{p.name}{p.active ? '' : ' (pausado)'}</option>)}
          </select>
        </label>
        <label className="field" style={{ marginBottom: 0 }}><span>Status</span>
          <select className="method-select" value={status} onChange={e => setStatus(e.target.value)}>
            {STATE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <Button className="action" onClick={() => load().catch(() => {})}>Atualizar</Button>
      </section>

      {summary && (
        <section className="sales-summary" aria-label="Resumo do período">
          <div><span>Vendas pagas</span><strong>{money(summary.paidAmountCents)}</strong><small>{summary.paidCount} cobrança(s)</small></div>
          <div><span>Pagas (teste)</span><strong>{money(summary.testAmountCents)}</strong><small>{summary.testCount} cobrança(s)</small></div>
          <div><span>Pendentes</span><strong>{summary.pendingCount}</strong><small>aguardando pagamento</small></div>
          <div><span>Total no período</span><strong>{summary.totalCount}</strong><small>cobranças</small></div>
        </section>
      )}

      {byPartner.length > 0 && (
        <>
          <h2>Totais por parceiro</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Parceiro</th><th>Pagas</th><th>Total cobrado</th><th>Cobranças</th></tr></thead>
            <tbody>
              {byPartner.map(t => (
                <tr key={t.partnerSlug ?? 'sem'}>
                  <td>{partnerName(t.partnerSlug)}</td>
                  <td>{t.paidCount}</td>
                  <td>{money(t.paidAmountCents)}</td>
                  <td>{t.totalCount}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      <h2>Cobranças do período</h2>
      {!rows ? <p role="status">Carregando vendas…</p> : rows.length === 0 ? <section className="pay-card"><p>Nenhuma cobrança encontrada neste período e filtro.</p></section> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Data</th><th>Parceiro</th><th>Vendedor</th><th>Loja</th><th>Gateway</th><th>Valor</th><th>Status</th><th>ID</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{when(r.createdAt)}</td>
                <td>{r.partnerSlug ? partnerName(r.partnerSlug) : '—'}</td>
                <td>{r.sellerName || '—'}</td>
                <td>{r.originLabel}</td>
                <td>{r.provider}</td>
                <td>{money(r.amount)}</td>
                <td><span className={'state-pill ' + r.state}>{r.state === 'paid' ? 'pago' : r.state === 'test_paid' ? 'pago (teste)' : r.state}</span></td>
                <td className="code-chip">{r.id.slice(0, 8)}…</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <section className="pay-card portal-card">
        <h2>Portal externo (Lucro Certo)</h2>
        <p className="muted">Ao confirmar um pagamento, o checkout envia a venda para o painel do Lucro Certo automaticamente (token Bearer + comprovante PDF gerado pela loja). A venda entra como pendente de análise, preservando todo o histórico do portal. Se o envio falhar, ele é repetido toda vez que esta página é aberta.</p>
        <form onSubmit={saveWebhook} className="inline-form">
          <label className="field" style={{ marginBottom: 0, flex: '1 1 320px' }}><span>URL de envio do portal (https)</span><Input value={webUrl} onChange={e => setWebUrl(e.target.value)} placeholder="https://bravus-omega.vercel.app/api/sales" autoComplete="off" /><small className="field-note">Para contas de atendente com mais de um checkout, acrescente <code>?checkout=&lt;id&gt;</code> no final da URL.</small></label>
          <label className="field" style={{ marginBottom: 0 }}><span>Token do portal</span><Input type="password" value={webSecret} onChange={e => setWebSecret(e.target.value)} placeholder={configured ? 'Já configurado — deixe em branco para manter' : 'gerado no painel do Lucro Certo'} autoComplete="off" /><small className="field-note">Token da conta que vai receber as vendas (12–160 letras, números, hífen ou sublinhado).</small></label>
          <Button className="action" type="submit" disabled={busy}>{busy ? 'Salvando…' : configured ? 'Atualizar' : 'Conectar portal'}</Button>
        </form>
        {configured && <p className="field-note">Conectado em: <span className="code-chip">{configured}</span></p>}
      </section>
    </main>
  );
}