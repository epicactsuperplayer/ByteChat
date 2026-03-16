self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'ByteChat', {
      body: data.body || '',
      icon: data.icon || 'https://i.imgur.com/NLz6Jfd.png',
      badge: 'https://i.imgur.com/NLz6Jfd.png',
      vibrate: [200, 100, 200],
      data: { url: 'https://bytestormchat.vercel.app' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
