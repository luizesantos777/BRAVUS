self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let message;
  try { message = event.data.json(); } catch { return; }
  if (!message || typeof message.body !== 'string') return;
  event.waitUntil(self.registration.showNotification('BRAVUS Brasil · Venda registrada', {
    body: message.body.slice(0, 1000),
    icon: new URL('favicon.svg', self.registration.scope).href,
    badge: new URL('favicon.svg', self.registration.scope).href,
    tag: 'bravus-venda',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const portal = clients.find(client => client.url.startsWith(self.registration.scope) && !client.url.includes('#/admin'));
    return portal ? portal.focus() : self.clients.openWindow(self.registration.scope);
  }));
});
