import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, Bell, BellOff, Camera, CheckCircle2, LoaderCircle, Save, UserRound } from 'lucide-react';
import { DEFAULT_SALE_ALERT, detectPixType, pixLabels, renderSaleAlert } from './domain.ts';
import type { PixType, Profile } from './domain.ts';
import { PortalClient, readAvatar } from './client.ts';
import { disableNotifications, enableNotifications, notificationState } from './notifications.ts';
import type { NotificationState } from './notifications.ts';

export function ProfileAvatar({ photoUrl, name, className = '' }: { photoUrl?: string; name: string; className?: string }) {
  return <span className={`profile-avatar ${className}`}>{photoUrl ? <img src={photoUrl} alt={`Foto de ${name}`} /> : <span aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || 'A'}</span>}</span>;
}
function NotificationsCard({ client, disabled }: { client: PortalClient; disabled: boolean }) {
  const [state, setState] = useState<NotificationState>('off'), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  useEffect(() => { let cancelled = false; notificationState(client).then(value => { if (!cancelled) setState(value); }).catch(() => undefined); return () => { cancelled = true; }; }, [client]);
  async function toggle() {
    if (busy || disabled) return; setBusy(true); setNote('');
    try {
      if (state === 'on') { await disableNotifications(client); setState('off'); }
      else { await enableNotifications(client); setState('on'); }
    } catch (cause) { setNote((cause as Error).message); setState(await notificationState(client).catch(() => 'off' as const)); }
    finally { setBusy(false); }
  }
  const label = state === 'on' ? 'Ativado' : state === 'blocked' ? 'Bloqueado' : state === 'unsupported' ? 'Indisponível' : 'Desativado';
  return <section className="profile-notifications" aria-label="Notificações no celular"><span className="notification-symbol">{state === 'on' ? <Bell size={20} /> : <BellOff size={20} />}</span><div className="notification-copy"><div><h3>Notificações Push no Celular</h3><span className={`notification-badge ${state === 'on' ? 'enabled' : ''}`}>{label}</span></div><p>Ative para receber alertas neste aparelho a cada venda registrada.{client.isDemo && ' Na demonstração, os alertas são de teste.'}</p>{note && <p className="notification-note" role="status">{note}</p>}</div><button type="button" className={`button ${state === 'on' ? 'secondary' : 'primary'}`} disabled={busy || disabled} onClick={() => void toggle()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Bell size={14} />}{state === 'on' ? 'Desativar neste aparelho' : 'Ativar Notificações no Celular'}</button></section>;
}

export default function ProfileForm({ profile, client, disabled, refresh, notify }: { profile: Profile; client: PortalClient; disabled: boolean; refresh: () => Promise<void>; notify: (notice: { text: string; error?: boolean }) => void }) {
  const [name, setName] = useState(profile.name), [photoUrl, setPhotoUrl] = useState(profile.photoUrl ?? ''), [template, setTemplate] = useState(profile.saleAlertTemplate ?? DEFAULT_SALE_ALERT);
  const [pixKey, setPixKey] = useState(profile.pixKey), [pixType, setPixType] = useState(profile.pixType), [pixOwner, setPixOwner] = useState(profile.pixOwner);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  async function selectPhoto(selected?: File) {
    if (!selected) return; setUploading(true); setError('');
    try { setPhotoUrl(await readAvatar(selected)); } catch (cause) { setError((cause as Error).message); }
    finally { setUploading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || disabled || uploading) return; setBusy(true); setError('');
    try {
      await client.saveProfile({ name, email: profile.email, phone: profile.phone, pixType, pixKey, pixOwner, photoUrl, saleAlertTemplate: template });
      notify({ text: client.isDemo ? 'Alterações salvas na demonstração.' : 'Alterações salvas com sucesso.' }); await refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel profile-panel"><div className="section-title"><UserRound size={18} /><h2>Dados Pessoais, Chave PIX &amp; Notificações Push</h2></div><p className="profile-description">Altere seu nome, personalize seus alertas de venda e cadastre sua chave PIX com segurança.</p>
    <NotificationsCard client={client} disabled={disabled} />
    <form onSubmit={submit}><fieldset disabled={disabled || busy}>
      <div className="profile-photo-row"><ProfileAvatar name={name} photoUrl={photoUrl} /><div><button type="button" className="button secondary" disabled={uploading} onClick={() => file.current?.click()}>{uploading ? <LoaderCircle size={14} className="spin" /> : <Camera size={14} />}Alterar Foto de Perfil</button><input className="sr-only" ref={file} type="file" tabIndex={-1} aria-label="Foto de perfil" accept="image/png,image/jpeg,image/webp" onChange={event => { void selectPhoto(event.target.files?.[0]); event.target.value = ''; }} /><p>Sua foto aparecerá nos rankings e no seu perfil.</p>{photoUrl && <button type="button" className="profile-remove-photo" onClick={() => setPhotoUrl('')}>Remover foto</button>}</div></div>
      <label className="profile-field" htmlFor="profile-name">Seu Nome / Apelido no Painel <span aria-hidden="true">*</span><input id="profile-name" required autoComplete="name" maxLength={120} placeholder="Ex: João Silva" value={name} onChange={event => setName(event.target.value)} /></label>
      <section className="profile-sale-alert"><div className="alert-heading"><h3><Bell size={14} />Personalizar Alerta de Venda</h3><span>Mensagem de sucesso para você</span></div><label className="sr-only" htmlFor="sale-alert-template">Texto do alerta de venda</label><input id="sale-alert-template" required maxLength={240} value={template} onChange={event => setTemplate(event.target.value)} /><p>Use <code>{'{valor}'}</code> para o total, <code>{'{qtd}'}</code> para a quantidade e <code>{'{nome}'}</code> para o seu nome. Exibido na tela assim que a venda for salva.</p><div className="sale-alert-preview" aria-label="Prévia do alerta de venda"><CheckCircle2 size={14} /><span><strong>Prévia:</strong> {renderSaleAlert(template, 19700, 1, name || 'Atendente')}</span></div></section>
      <label className="profile-field" htmlFor="profile-pix-key">Chave PIX para Pagamento <span aria-hidden="true">*</span><input id="profile-pix-key" required maxLength={180} autoComplete="off" placeholder="CPF, E-mail, Telefone ou Chave Aleatória..." value={pixKey} onChange={event => { setPixKey(event.target.value); setPixType(detectPixType(event.target.value)); }} /></label>
      {pixKey && <div className="profile-pix-type"><label htmlFor="profile-pix-type">Tipo da chave PIX</label><select id="profile-pix-type" value={pixType} required onChange={event => setPixType(event.target.value as PixType)}>{Object.entries(pixLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><span>Confira o tipo identificado.</span></div>}
      <label className="profile-field" htmlFor="profile-pix-owner">Nome Completo do Titular da Chave PIX<input id="profile-pix-owner" required={!!pixKey} maxLength={120} autoComplete="name" placeholder="Nome que consta na conta bancária..." value={pixOwner} onChange={event => setPixOwner(event.target.value)} /></label>
      {error && <p className="form-error" role="alert"><AlertCircle size={14} />{error}</p>}
      <div className="profile-save-actions"><button className="button primary" type="submit" disabled={uploading}>{busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}Salvar Alterações</button></div>
    </fieldset></form>
  </section>;
}
