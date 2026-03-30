importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAY49sWaN-DSKV10uyBB3CeOiABLCtFrSI",
  authDomain: "bytestorm-friebase-server.firebaseapp.com",
  databaseURL: "https://bytestorm-friebase-server-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bytestorm-friebase-server",
  storageBucket: "bytestorm-friebase-server.firebasestorage.app",
  messagingSenderId: "400056781433",
  appId: "1:400056781433:web:9803b0711d85de437f62a8",
  measurementId: "G-TKJ9JKK7ZF"
});

const messaging = firebase.messaging();

// Background message handler — fires when site is closed or in background
messaging.onBackgroundMessage(payload => {
  const { title, body, icon, badge, tag } = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(title || 'ByteChat', {
    body: body || data.body || '',
    icon: icon || data.icon || 'https://i.imgur.com/NLz6Jfd.png',
    badge: badge || 'https://i.imgur.com/NLz6Jfd.png',
    tag: tag || data.tag || 'bytechat-msg',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || 'https://bytestormchat.vercel.app' }
  });
});

// Notification click — open/focus the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://bytestormchat.vercel.app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('bytestormchat.vercel.app') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Install + activate — take over immediately
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
