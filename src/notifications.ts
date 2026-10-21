import type { PortalClient } from './client.ts';

export type NotificationState = 'off' | 'on' | 'blocked' | 'unsupported';
const DEMO_NOTIFICATIONS = 'bravus.demo.notifications.v1';
function supported() { return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator; }
function workerPath() {
  const base = window.location.hostname.endsWith('.github.io') ? '/' + window.location.pathname.split('/').filter(Boolean)[0] + '/' : import.meta.env.BASE_URL;
  return new URL(`${base}notifications-worker.js`, window.location.origin);
}
async function endpointId(endpoint: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function notificationState(client: PortalClient): Promise<NotificationState> {
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
export async function enableNotifications(client: PortalClient) {
  if (!supported()) throw new Error('Este navegador não oferece notificações neste modo. Abra o portal em um navegador com suporte a notificações.');
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
export async function disableNotifications(client: PortalClient) {
  if (client.isDemo) { localStorage.removeItem(DEMO_NOTIFICATIONS); return; }
  const registration = await navigator.serviceWorker.getRegistration(workerPath().href), subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await client.unsubscribePush(await endpointId(subscription.endpoint));
  await subscription.unsubscribe();
}
export async function notifyDemoSale(client: PortalClient, body: string) {
  try {
    if (!client.isDemo || await notificationState(client) !== 'on') return;
    const registration = await navigator.serviceWorker.getRegistration(workerPath().href);
    await registration?.showNotification('BRAVUS Brasil · Demonstração', { body, icon: new URL('favicon.svg', registration.scope).href });
  } catch { /* The sale stays saved if a notification cannot be displayed. */ }
}
