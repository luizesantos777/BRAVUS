import { useEffect, useId, useState } from 'react';
import { Bell, BellOff, LoaderCircle } from 'lucide-react';
import { disableNotifications, enableNotifications, notificationState, notificationUnsupportedMessage } from './notifications.ts';
import type { NotificationClient, NotificationState } from './notifications.ts';

export default function NotificationsCard({ client, disabled, title = 'Notificações Push no Celular', description = 'Ative para receber alertas neste aparelho a cada venda registrada.', enableLabel = 'Ativar Notificações no Celular' }: { client: NotificationClient; disabled: boolean; title?: string; description?: string; enableLabel?: string }) {
  const [state, setState] = useState<NotificationState>('off'), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const [showInstall, setShowInstall] = useState(false), guideId = useId();
  useEffect(() => { let cancelled = false; notificationState(client).then(value => { if (!cancelled) setState(value); }).catch(() => undefined); return () => { cancelled = true; }; }, [client]);
  async function toggle() {
    if (state === 'install-required') { setShowInstall(value => !value); return; }
    if (busy || disabled) return; setBusy(true); setNote('');
    try {
      if (state === 'on') { await disableNotifications(client); setState('off'); }
      else { await enableNotifications(client); setState('on'); }
    } catch (cause) { setNote((cause as Error).message); setState(await notificationState(client).catch(() => 'off' as const)); }
    finally { setBusy(false); }
  }
  const label = state === 'on' ? 'Ativado' : state === 'blocked' ? 'Bloqueado' : state === 'install-required' ? 'Instalar no iPhone' : state === 'unsupported' ? 'Indisponível' : 'Desativado';
  const message = note || (state === 'unsupported' ? notificationUnsupportedMessage() : '');
  return <section className="profile-notifications" aria-label={title}><span className="notification-symbol">{state === 'on' ? <Bell size={20} /> : <BellOff size={20} />}</span><div className="notification-copy"><div><h3>{title}</h3><span className={`notification-badge ${state === 'on' ? 'enabled' : ''}`}>{label}</span></div><p>{description}{client.isDemo && ' Na demonstração, os alertas são de teste.'}</p>{state === 'install-required' && <p className="notification-note">No iPhone, adicione o BRAVUS à Tela de Início. Requer iOS 16.4 ou superior.</p>}{message && <p className="notification-note" role="status">{message}</p>}{state === 'install-required' && showInstall && <div className="notification-install-guide" id={guideId}><ol><li>Abra este link no <strong>Safari</strong>, fora do navegador do WhatsApp.</li><li>Toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</li><li>Abra o <strong>BRAVUS pelo novo ícone</strong>. Entre no seu painel e toque no botão para ativar os alertas.</li><li>Toque em <strong>Permitir</strong> quando o iPhone solicitar.</li></ol></div>}</div><button type="button" className={`button ${state === 'on' ? 'secondary' : 'primary'}`} disabled={busy || disabled} aria-expanded={state === 'install-required' ? showInstall : undefined} aria-controls={state === 'install-required' && showInstall ? guideId : undefined} onClick={() => void toggle()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Bell size={14} />}{state === 'on' ? 'Desativar neste aparelho' : state === 'install-required' ? 'Como ativar no iPhone' : enableLabel}</button></section>;
}
