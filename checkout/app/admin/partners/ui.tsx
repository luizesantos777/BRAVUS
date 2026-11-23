'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BIOCAMISAS_ORIGIN, BRAVUS_PAYMENT_ORIGIN } from '@/lib/checkout-brand';

type Partner = { slug: string; name: string; active: boolean };

const slugify = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default function Parceiros() {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/partners', { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Falha ao carregar.');
      setPartners(d.partners || []);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function api(method: string, body?: unknown, url = '/api/admin/partners') {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || 'Não foi possível concluir.');
    return d;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy('criar'); setError(''); setNotice('');
    try {
      await api('POST', { slug, name });
      setSlug(''); setName(''); setSlugTouched(false);
      setNotice('Parceiro criado. Copie um dos links e envie para ele.');
      load();
    } catch (e2) { setError((e2 as Error).message); } finally { setBusy(''); }
  }

  async function toggle(p: Partner) {
    if (busy) return;
    setBusy(p.slug); setError(''); setNotice('');
    try {
      await api('PATCH', { slug: p.slug, active: !p.active });
      setNotice(p.active ? 'Parceiro pausado. O link mostra a mensagem de link desativado.' : 'Parceiro reativado.');
      load();
    } catch (e2) { setError((e2 as Error).message); } finally { setBusy(''); }
  }

  async function rename(p: Partner) {
    if (busy) return;
    const next = (renaming[p.slug] ?? '').trim();
    if (!next) return;
    setBusy(p.slug); setError(''); setNotice('');
    try {
      await api('PUT', { slug: p.slug, name: next });
      setRenaming(current => ({ ...current, [p.slug]: '' }));
      setNotice('Nome atualizado. As vendas novas aparecem com o nome novo.');
      load();
    } catch (e2) { setError((e2 as Error).message); } finally { setBusy(''); }
  }

  async function remove(p: Partner) {
    if (busy) return;
    if (!window.confirm('Excluir o parceiro "' + p.name + '"? O link dele deixa de funcionar.')) return;
    setBusy(p.slug); setError(''); setNotice('');
    try {
      await api('DELETE', undefined, '/api/admin/partners?slug=' + encodeURIComponent(p.slug));
      setNotice('Parceiro excluído.');
      load();
    } catch (e2) { setError((e2 as Error).message); } finally { setBusy(''); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice('Link copiado: ' + text); }
    catch { setNotice('Não foi possível copiar automaticamente. Selecione o texto do link.'); }
  }

  return (
    <main className="pay-shell gateway-page">
      <header className="pay-brand">
        <img src="/assets/bravus-logo.jpg" alt="Bravus Brasil" />
        <div><strong>BRAVUS BRASIL</strong><small>Painel privado de pagamentos</small></div>
      </header>
      <nav className="admin-nav"><a href="/admin/gateways">Gateways</a><a href="/admin/vendas">Vendas</a><a href="/admin/partners" className="active">Parceiros</a></nav>
      <div className="gateway-page-title"><div><h1>Parceiros</h1><p className="muted">Cada parceiro tem um link de checkout próprio. Quem compra por ele tem a identificação fixada na venda, e o resultado aparece em Vendas sem lançamento manual.</p></div></div>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="success">{notice}</p>}

      <section className="pay-card" style={{ marginBottom: '1rem' }}>
        <h2>Novo parceiro</h2>
        <form onSubmit={create} className="inline-form">
          <label className="field" style={{ marginBottom: 0, flex: '1 1 220px' }}><span>Identificador (para o link)</span><Input value={slug} onChange={e => { setSlugTouched(true); setSlug(e.target.value); }} placeholder="ex.: joao-petisco" autoComplete="off" minLength={2} maxLength={40} required /></label>
          <label className="field" style={{ marginBottom: 0, flex: '1 1 260px' }}><span>Nome do parceiro</span><Input value={name} onChange={e => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} placeholder="ex.: João Petisco" autoComplete="off" minLength={2} maxLength={100} required /></label>
          <Button className="action" type="submit" disabled={!!busy}>{busy === 'criar' ? 'Criando…' : '+ Criar parceiro'}</Button>
        </form>
        <p className="field-note">O identificador vira o link /p/&lt;identificador&gt;. O nome é gravado em cada venda feita pelo parceiro.</p>
      </section>

      {!partners ? <p role="status">Carregando parceiros…</p> : partners.length === 0 ? <section className="pay-card"><p>Você ainda não tem parceiros. Crie o primeiro acima.</p></section> : (
        <div className="gateway-grid">
          {partners.map(p => {
            const links = [BRAVUS_PAYMENT_ORIGIN + '/p/' + p.slug, BIOCAMISAS_ORIGIN + '/p/' + p.slug];
            return (
              <section key={p.slug} className={'pay-card gateway-card' + (p.active ? ' selected' : '')} aria-label={'Parceiro ' + p.name}>
                <div className="gateway-card-head"><h2>{p.name}</h2><span className={'gateway-badge' + (p.active ? ' on' : '')}>{p.active ? 'Ativo' : 'Pausado'}</span></div>
                <p className="muted">Link: /p/{p.slug}</p>
                <div className="row-actions" style={{ marginBottom: '.5rem' }}>
                  {links.map(url => (
                    <span key={url} className="code-chip" style={{ display: 'flex', gap: '.5rem', alignItems: 'center', maxWidth: '100%' }}>
                      <span style={{ wordBreak: 'break-all' }}>{url}</span>
                      <button type="button" className="action" style={{ whiteSpace: 'nowrap' }} onClick={() => copy(url)}>copiar</button>
                    </span>
                  ))}
                </div>
                <div className="row-actions">
                  <Input style={{ flex: '1 1 180px' }} value={renaming[p.slug] ?? ''} onChange={e => setRenaming(c => ({ ...c, [p.slug]: e.target.value }))} placeholder={'Renomear "' + p.name + '"'} maxLength={100} />
                  <Button className="action" disabled={!!busy || !(renaming[p.slug] ?? '').trim()} onClick={() => rename(p)}>Salvar nome</Button>
                  <Button className="action" disabled={!!busy} onClick={() => toggle(p)}>{busy === p.slug ? '…' : p.active ? 'Pausar' : 'Ativar'}</Button>
                  <Button className="action" disabled={!!busy} onClick={() => remove(p)}>Excluir</Button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}