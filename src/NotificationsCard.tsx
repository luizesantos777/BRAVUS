import { useEffect, useId, useRef, useState } from 'react';
import { Bell, BellOff, LoaderCircle } from 'lucide-react';
import { disableNotifications, enableNotifications, notificationDiagnostic, notificationErrorMessage, notificationState, notificationUnsupportedMessage } from './notifications.ts';
import type { NotificationClient, NotificationDiagnostic, NotificationState } from './notifications.ts';

export default function NotificationsCard({ client, disabled, title = 'Notificações Push no Celular', description = 'Ative para receber alertas neste aparelho a cada venda registrada.', enableLabel = 'Ativar Notificações no Celular' }: { client: NotificationClient; disabled: boolean; title?: string; description?: string; enableLabel?: string }) {
  const [state, setState] = useState<NotificationState>('off'), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const [showInstall, setShowInstall] = useState(false), guideId = useId();
  const [diagnostic, setDiagnostic] = useState<NotificationDiagnostic | null>(null), refreshing = useRef(0), interacting = useRef(false);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      if (interacting.current || document.visibilityState === 'hidden') return;
      const request = ++refreshing.current;
      notificationState(client).then(value => {
        if (!cancelled && request === refreshing.current) { setState(value); setNote(''); setDiagnostic(null); }
      }).catch(cause => { if (!cancelled && request === refreshing.current) setNote(notificationErrorMessage(cause)); });
    }
    refresh();
    // Recheck after returning from iPhone Settings or resuming the installed app.
    window.addEventListener('pageshow', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; window.removeEventListener('pageshow', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [client]);
  async function toggle() {
    if (state === 'install-required') { setShowInstall(value => !value); return; }
    if (interacting.current || disabled) return; interacting.current = true; ++refreshing.current; setBusy(true); setNote(''); setDiagnostic(null);
    try {
      if (state === 'on') { await disableNotifications(client); setState('off'); }
      else { await enableNotifications(client); setState('on'); }
    } catch (cause) { setNote(notificationErrorMessage(cause)); setState(await notificationState(client).catch(() => 'off' as const)); }
    finally { interacting.current = false; setBusy(false); }
  }
  async function diagnose() {
    if (interacting.current || disabled) return; interacting.current = true; ++refreshing.current; setBusy(true); setNote('');
    try { const result = await notificationDiagnostic(client); setDiagnostic(result); if (result.state) setState(result.state); }
    catch (cause) { setNote(notificationErrorMessage(cause)); }
    finally { interacting.current = false; setBusy(false); }
  }
  const label = state === 'on' ? 'Ativado' : state === 'blocked' ? 'Bloqueado' : state === 'install-required' ? 'Instalar no iPhone' : state === 'unsupported' ? 'Indisponível' : 'Desativado';
  const message = note || (state === 'unsupported' ? notificationUnsupportedMessage() : '');
  return <section className="profile-notifications" aria-label={title}>
    <span className="notification-symbol">{state === 'on' ? <Bell size={20} /> : <BellOff size={20} />}</span>
    <div className="notification-copy">
      <div><h3>{title}</h3><span className={`notification-badge ${state === 'on' ? 'enabled' : ''}`}>{label}</span></div>
      <p>{description}{client.isDemo && ' Na demonstração, os alertas são de teste.'}</p>
      {state === 'install-required' && <p className="notification-note">No iPhone, adicione o BRAVUS à Tela de Início. Requer iOS 16.4 ou superior.</p>}
      {message && <p className="notification-note" role="status">{message}</p>}
      {state === 'install-required' && showInstall && <div className="notification-install-guide" id={guideId}><ol>
        <li>Abra este link no <strong>Safari</strong>, fora do navegador do WhatsApp.</li>
        <li>Toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</li>
        <li>Abra o <strong>BRAVUS pelo novo ícone</strong>. Entre no seu painel e toque no botão para ativar os alertas.</li>
        <li>Toque em <strong>Permitir</strong> quando o iPhone solicitar.</li>
      </ol></div>}
    </div>
    <div className="notification-actions">
      <button type="button" className={`button ${state === 'on' ? 'secondary' : 'primary'}`} disabled={busy || disabled || state === 'unsupported'} aria-expanded={state === 'install-required' ? showInstall : undefined} aria-controls={state === 'install-required' && showInstall ? guideId : undefined} onClick={() => void toggle()}>
        {busy ? <LoaderCircle size={14} className="spin" /> : <Bell size={14} />}{state === 'on' ? 'Desativar neste aparelho' : state === 'install-required' ? 'Como ativar no iPhone' : enableLabel}
      </button>
      <button type="button" className="notification-check" disabled={busy || disabled} onClick={() => void diagnose()}>Verificar notificações</button>
    </div>
    {diagnostic && <div className="notification-diagnostic" role="status" aria-label="Verificação das notificações">
      <p>{diagnostic.result}</p>
      <dl>{diagnostic.checks.map(check => <div key={check.label}><dt>{check.label}</dt><dd>{check.value}</dd></div>)}</dl>
    </div>}
  </section>;
}
