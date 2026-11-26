self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let message;
  try { message = event.data.json(); } catch { return; }
  if (!message || typeof message.body !== 'string') return;
  const admin = message.target === 'admin';
  event.waitUntil((async () => {
    const target = admin ? 'admin' : 'attendant';
    await self.registration.showNotification('Lucro Certo Pay · Nova venda aprovada', {
      body: message.body.slice(0, 1000),
      icon: new URL('lucro-certo-wolf-icon-192.png', self.registration.scope).href,
      badge: new URL('lucro-certo-wolf-icon-192.png', self.registration.scope).href,
      tag: admin && typeof message.tag === 'string' ? message.tag.slice(0, 100) : 'bravus-venda',
      // Keep the platform's notification sound enabled. When the admin panel
      // is open, the page also plays the short money-drop cue below.
      silent: false,
      renotify: true,
      vibrate: admin ? [120, 80, 120, 80, 240] : [100, 60, 160],
      data: { target },
    });
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'lucro-certo-money-drop', target });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const admin = event.notification.data?.target === 'admin';
    const portal = clients.find(client => client.url.startsWith(self.registration.scope) && (client.url.includes('#/admin') || /\/admin\/?(?:\?|$)/.test(new URL(client.url).pathname)) === admin);
    return portal ? portal.focus() : self.clients.openWindow(new URL(admin ? '#/admin' : './', self.registration.scope).href);
  }));
});
