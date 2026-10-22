import { isAppleMobile, needsAppleInstallation, publicAssetUrl } from './pwa.ts';

export interface NotificationClient {
  readonly isDemo: boolean;
  pushConfig(): Promise<{ publicKey: string; subscriptionIds: string[] }>;
  subscribePush(subscription: PushSubscriptionJSON): Promise<unknown>;
  unsubscribePush(id: string): Promise<unknown>;
}

export type NotificationState = 'off' | 'on' | 'blocked' | 'unsupported' | 'install-required';
const DEMO_NOTIFICATIONS = 'bravus.demo.notifications.v1';
function supported() { return window.isSecureContext && typeof window.Notification !== 'undefined' && 'serviceWorker' in navigator; }
export function notificationUnsupportedMessage() {
  return isAppleMobile() ? 'No iPhone e iPad, use iOS 16.4 ou superior e abra o BRAVUS pelo ícone da Tela de Início para ativar as notificações.' : 'Este navegador não oferece notificações neste modo. Abra o portal em um navegador com suporte a notificações.';
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
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  if (client.isDemo) return localStorage.getItem(DEMO_NOTIFICATIONS) === 'on' ? 'on' : 'off';
  if (!('PushManager' in window)) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration(workerPath().href), subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return 'off';
  const config = await client.pushConfig();
  return config.subscriptionIds.includes(await endpointId(subscription.endpoint)) ? 'on' : 'off';
}
export async function enableNotifications(client: NotificationClient) {
  if (needsAppleInstallation()) throw new Error('No iPhone, abra o link no Safari, toque em Compartilhar e Adicionar à Tela de Início. Depois abra o BRAVUS pelo novo ícone e ative as notificações.');
  if (!supported()) throw new Error(notificationUnsupportedMessage());
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('As notificações não foram autorizadas. Você pode permitir nas configurações deste site no navegador.');
  const registration = await navigator.serviceWorker.register(workerPath().href);
  await navigator.serviceWorker.ready;
  if (client.isDemo) { localStorage.setItem(DEMO_NOTIFICATIONS, 'on'); return; }
  if (!('PushManager' in window)) throw new Error('Este navegador não oferece notificações push.');
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
    await registration?.showNotification('BRAVUS Brasil · Demonstração', { body, icon: new URL('favicon.svg', registration.scope).href });
  } catch { /* The sale stays saved if a notification cannot be displayed. */ }
}
