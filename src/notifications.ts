import { isAppleMobile, isInstalledApp, needsAppleInstallation, publicAssetUrl } from './pwa.ts';

export interface NotificationClient {
  readonly isDemo: boolean;
  pushConfig(): Promise<{ publicKey: string; subscriptionIds: string[] }>;
  subscribePush(subscription: PushSubscriptionJSON): Promise<unknown>;
  unsubscribePush(id: string): Promise<unknown>;
}

export type NotificationState = 'off' | 'on' | 'blocked' | 'unsupported' | 'install-required';
const DEMO_NOTIFICATIONS = 'bravus.demo.notifications.v1';
function supported(client: NotificationClient) { return window.isSecureContext && typeof window.Notification !== 'undefined' && 'serviceWorker' in navigator && (client.isDemo || 'PushManager' in window); }
export function notificationUnsupportedMessage() {
  if (!window.isSecureContext) return 'Abra o BRAVUS pelo endereço HTTPS para ativar as notificações.';
  return isAppleMobile() && isInstalledApp() ? 'O BRAVUS está aberto como app, mas o iPhone não disponibilizou o serviço de notificações. Toque em Verificar notificações para conferir o impedimento.' : 'Este navegador não oferece notificações neste modo. Abra o portal em um navegador com suporte a notificações.';
}
function blockedMessage() { return isAppleMobile() ? 'No iPhone, abra Ajustes > Notificações, selecione o app instalado e ative Permitir Notificações. Depois volte ao painel.' : 'As notificações estão bloqueadas. Permita as notificações nas configurações deste site no navegador e volte ao painel.'; }
export function notificationErrorMessage(cause: unknown) {
  if (cause instanceof DOMException) {
    if (cause.name === 'NotAllowedError') return typeof window.Notification !== 'undefined' && Notification.permission === 'denied' ? blockedMessage() : 'O aparelho recusou a ativação. Toque em Verificar notificações para conferir a permissão e o serviço neste aparelho.';
    if (cause.name === 'InvalidStateError') return 'O serviço de notificações ainda não iniciou neste aparelho. Feche o BRAVUS, abra novamente e tente ativar.';
    if (cause.name === 'NotSupportedError') return notificationUnsupportedMessage();
    return 'Não foi possível concluir a conexão com o serviço de notificações. Verifique sua conexão e tente novamente.';
  }
  return cause instanceof Error ? cause.message : 'Não foi possível verificar as notificações. Tente novamente.';
}
function workerPath() {
  return new URL(publicAssetUrl('notifications-worker.js'));
}
async function endpointId(endpoint: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function notificationState(client: NotificationClient): Promise<NotificationState> {
  if (needsAppleInstallation()) return 'install-required';
  if (!supported(client)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  if (client.isDemo) return localStorage.getItem(DEMO_NOTIFICATIONS) === 'on' ? 'on' : 'off';
  const registration = await navigator.serviceWorker.getRegistration(workerPath().href), subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return 'off';
  const config = await client.pushConfig();
  return config.subscriptionIds.includes(await endpointId(subscription.endpoint)) ? 'on' : 'off';
}
export async function enableNotifications(client: NotificationClient) {
  if (needsAppleInstallation()) throw new Error('No iPhone, abra o link no Safari, toque em Compartilhar e Adicionar à Tela de Início. Depois abra o BRAVUS pelo novo ícone e ative as notificações.');
  if (!supported(client)) throw new Error(notificationUnsupportedMessage());
  // Request only from the button's gesture, and never prompt again after consent.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? blockedMessage() : 'A autorização não foi concluída. Toque em ativar novamente e escolha Permitir.');
  const registration = await navigator.serviceWorker.register(workerPath().href);
  await navigator.serviceWorker.ready;
  if (client.isDemo) { localStorage.setItem(DEMO_NOTIFICATIONS, 'on'); return; }
  const config = await client.pushConfig();
  const decoded = atob(config.publicKey.replaceAll('-', '+').replaceAll('_', '/'));
  const key = Uint8Array.from(decoded, char => char.charCodeAt(0));
  let subscription = await registration.pushManager.getSubscription();
  if (subscription?.options.applicationServerKey) {
    const existing = new Uint8Array(subscription.options.applicationServerKey);
    if (existing.length !== key.length || existing.some((byte, index) => byte !== key[index])) { await subscription.unsubscribe(); subscription = null; }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await client.subscribePush(subscription.toJSON());
}

export interface NotificationDiagnostic {
  state: NotificationState | null;
  result: string;
  checks: { label: string; value: string }[];
}
export async function notificationDiagnostic(client: NotificationClient): Promise<NotificationDiagnostic> {
  // Read-only checks: never prompt, create a subscription, or include access keys/URLs.
  const [server, status] = await Promise.allSettled([
    client.isDemo ? Promise.resolve(null) : client.pushConfig(),
    notificationState(client),
  ]);
  const state = status.status === 'fulfilled' ? status.value : null;
  const permission = typeof window.Notification === 'undefined' ? 'Indisponível' : ({ granted: 'Permitida', denied: 'Bloqueada', default: 'Ainda não solicitada' }[Notification.permission]);
  const results: Record<NotificationState, string> = {
    'install-required': 'Este acesso está funcionando como página do navegador, mesmo que você tenha criado um ícone. O iPhone ainda não o reconhece como app instalado.',
    unsupported: notificationUnsupportedMessage(),
    blocked: blockedMessage(),
    off: 'Os alertas ainda não estão ativados para este painel neste aparelho. Toque em ativar para concluir.',
    on: 'Este aparelho está inscrito para receber os alertas deste painel.',
  };
  return {
    state,
    result: server.status === 'rejected' ? notificationErrorMessage(server.reason) : status.status === 'rejected' ? notificationErrorMessage(status.reason) : results[status.value],
    checks: [
      { label: 'Abertura', value: isInstalledApp() ? 'App da Tela de Início' : 'Página do navegador' },
      { label: 'Conexão segura', value: window.isSecureContext ? 'Sim' : 'Não' },
      { label: 'Notificações do aparelho', value: typeof window.Notification !== 'undefined' ? 'Disponíveis' : 'Indisponíveis' },
      { label: 'Permissão', value: permission },
      { label: 'Serviço em segundo plano', value: 'serviceWorker' in navigator ? 'Disponível' : 'Indisponível' },
      { label: 'Notificações push', value: 'PushManager' in window ? 'Disponíveis' : 'Indisponíveis' },
      { label: 'Servidor BRAVUS', value: client.isDemo ? 'Demonstração' : server.status === 'fulfilled' ? 'Disponível' : 'Falha na conexão' },
    ],
  };
}
export async function disableNotifications(client: NotificationClient) {
  if (client.isDemo) { localStorage.removeItem(DEMO_NOTIFICATIONS); return; }
  const registration = await navigator.serviceWorker.getRegistration(workerPath().href), subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await client.unsubscribePush(await endpointId(subscription.endpoint));
  // The same browser subscription may also receive alerts for another signed-in role.
}
export async function notifyDemoSale(client: NotificationClient, body: string) {
  try {
    if (!client.isDemo || await notificationState(client) !== 'on') return;
    const registration = await navigator.serviceWorker.getRegistration(workerPath().href);
    await registration?.showNotification('BRAVUS Brasil · Demonstração', { body, icon: new URL('firebot-icon-192.png', registration.scope).href });
  } catch { /* The sale stays saved if a notification cannot be displayed. */ }
}
