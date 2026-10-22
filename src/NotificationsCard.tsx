import { useEffect, useState } from 'react';
import { Bell, BellOff, LoaderCircle } from 'lucide-react';
import { disableNotifications, enableNotifications, notificationState } from './notifications.ts';
import type { NotificationClient, NotificationState } from './notifications.ts';

export default function NotificationsCard({ client, disabled, title = 'Notificações Push no Celular', description = 'Ative para receber alertas neste aparelho a cada venda registrada.', enableLabel = 'Ativar Notificações no Celular' }: { client: NotificationClient; disabled: boolean; title?: string; description?: string; enableLabel?: string }) {
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
  return <section className="profile-notifications" aria-label={title}><span className="notification-symbol">{state === 'on' ? <Bell size={20} /> : <BellOff size={20} />}</span><div className="notification-copy"><div><h3>{title}</h3><span className={`notification-badge ${state === 'on' ? 'enabled' : ''}`}>{label}</span></div><p>{description}{client.isDemo && ' Na demonstração, os alertas são de teste.'}</p>{note && <p className="notification-note" role="status">{note}</p>}</div><button type="button" className={`button ${state === 'on' ? 'secondary' : 'primary'}`} disabled={busy || disabled} onClick={() => void toggle()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Bell size={14} />}{state === 'on' ? 'Desativar neste aparelho' : enableLabel}</button></section>;
}
