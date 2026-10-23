self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let message;
  try { message = event.data.json(); } catch { return; }
  if (!message || typeof message.body !== 'string') return;
  const admin = message.target === 'admin';
  event.waitUntil(self.registration.showNotification(admin ? 'Nova venda aprovada' : 'BRAVUS Brasil · Venda registrada', {
    body: message.body.slice(0, 1000),
    icon: new URL('firebot-icon-192.png', self.registration.scope).href,
    badge: new URL('firebot-icon-192.png', self.registration.scope).href,
    tag: admin && typeof message.tag === 'string' ? message.tag.slice(0, 100) : 'bravus-venda',
    data: { target: admin ? 'admin' : 'attendant' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const admin = event.notification.data?.target === 'admin';
    const portal = clients.find(client => client.url.startsWith(self.registration.scope) && (client.url.includes('#/admin') || /\/admin\/?(?:\?|$)/.test(new URL(client.url).pathname)) === admin);
    return portal ? portal.focus() : self.clients.openWindow(new URL(admin ? '#/admin' : './', self.registration.scope).href);
  }));
});
