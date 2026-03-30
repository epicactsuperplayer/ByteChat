importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
const LOGO = 'https://raw.githubusercontent.com/epicactsuperplayer/ByteChat/main/Bytestorm%20Logo.png';
const APP_URL = 'https://bytestormchat.vercel.app';
const FIREBASE_PROJECT = 'bytestorm-friebase-server';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || APP_URL;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('bytestormchat.vercel.app') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Session state ───────────────────────────────────────────────
let session = null;

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'INIT_SESSION') {
    session = event.data.payload;
    // Store sw start time so we only notify about messages AFTER this point
    if (!session.startTime) session.startTime = Date.now();
    startPolling();
  }
  if (event.data.type === 'UPDATE_PREFS') {
    if (session) session.prefs = event.data.payload;
  }
  if (event.data.type === 'CLEAR_SESSION') {
    session = null;
    stopPolling();
  }
});

// ── Polling ─────────────────────────────────────────────────────
let pollTimer = null;
const POLL_INTERVAL = 8000;

// Use a persistent cache via IndexedDB so seen IDs survive SW restarts
const DB_NAME = 'bytechat-sw';
const STORE = 'seen';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function hasSeen(id) {
  try {
    const db = await openDB();
    return new Promise(resolve => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch { return false; }
}

async function markSeen(id) {
  try {
    const db = await openDB();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(true, id);
  } catch {}
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function poll() {
  if (!session) return;

  // Don't notify when app is visible and focused
  const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const appVisible = allClients.some(c =>
    c.url.includes('bytestormchat.vercel.app') && c.visibilityState === 'visible'
  );
  if (appVisible) return;

  const { uid, name, idToken, prefs = {}, startTime } = session;
  // Only look at messages from the last 20 seconds (2.5x poll interval)
  const since = Math.max(startTime || 0, Date.now() - 20000);

  try {
    if (prefs.mentions !== false) {
      await checkGlobalMessages(uid, name, idToken, since);
    }
    if (prefs.dms !== false || prefs.media !== false) {
      await checkDms(uid, name, idToken, since, prefs);
    }
  } catch(e) {
    if (e.message && e.message.includes('401')) stopPolling();
  }
}

// ── Global chat: check for @mentions using a structured query ───
async function checkGlobalMessages(myUid, myName, idToken, since) {
  // Use Firestore structured query to get only recent messages, ordered by time desc
  const url = `${FIRESTORE_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'messages' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'time' },
          op: 'GREATER_THAN',
          value: { integerValue: since.toString() }
        }
      },
      orderBy: [{ field: { fieldPath: 'time' }, direction: 'DESCENDING' }],
      limit: 15
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(res.status.toString());
  const results = await res.json();

  for (const item of results) {
    if (!item.document) continue;
    const doc = item.document;
    const fields = doc.fields || {};
    const msgUid  = fields.uid?.stringValue;
    const msgTime = parseInt(fields.time?.integerValue || '0');
    const msgName = fields.name?.stringValue || 'Someone';
    const msgText = fields.text?.stringValue || '';
    const msgPfp  = fields.pfp?.stringValue || LOGO;
    const docId   = doc.name.split('/').pop();

    if (msgUid === myUid) continue;
    if (msgTime < since) continue;
    if (await hasSeen(docId)) continue;
    await markSeen(docId);

    const mentionedMe  = msgText.toLowerCase().includes(`@${myName.toLowerCase()}`);
    const mentionedAll = msgText.toLowerCase().includes('@everyone');
    if (!mentionedMe && !mentionedAll) continue;

    showNotif(`${msgName} mentioned you`, msgText, msgPfp, docId);
  }
}

// ── DMs: check accepted DM conversations for new messages ───────
async function checkDms(myUid, myName, idToken, since, prefs) {
  // Query DMs where this user is a participant and status is accepted
  const url = `${FIRESTORE_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'dms' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'users' },
                op: 'ARRAY_CONTAINS',
                value: { stringValue: myUid }
              }
            },
            {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'EQUAL',
                value: { stringValue: 'accepted' }
              }
            }
          ]
        }
      },
      limit: 20
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) return;
  const results = await res.json();

  for (const item of results) {
    if (!item.document) continue;
    const dmId = item.document.name.split('/').pop();

    // Get recent messages in this DM using a structured query
    const msgsUrl = `${FIRESTORE_BASE}:runQuery`;
    const msgsBody = {
      structuredQuery: {
        from: [{ collectionId: 'messages', allDescendants: false }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'time' },
            op: 'GREATER_THAN',
            value: { integerValue: since.toString() }
          }
        },
        orderBy: [{ field: { fieldPath: 'time' }, direction: 'DESCENDING' }],
        limit: 5
      },
      parent: `${FIRESTORE_BASE}/dms/${dmId}`
    };

    const msgsRes = await fetch(msgsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
      },
      body: JSON.stringify(msgsBody)
    });

    if (!msgsRes.ok) continue;
    const msgsResults = await msgsRes.json();

    for (const msgItem of msgsResults) {
      if (!msgItem.document) continue;
      const f = msgItem.document.fields || {};
      const msgUid  = f.uid?.stringValue;
      const msgTime = parseInt(f.time?.integerValue || '0');
      const msgName = f.name?.stringValue || 'Someone';
      const msgText = f.text?.stringValue || '';
      const msgType = f.type?.stringValue || 'text';
      const msgPfp  = f.pfp?.stringValue || LOGO;
      const docId   = msgItem.document.name.split('/').pop();

      if (msgUid === myUid) continue;
      if (msgTime < since) continue;
      if (await hasSeen(docId)) continue;
      await markSeen(docId);

      const isMedia = msgType === 'image' || msgType === 'video';
      if (isMedia && prefs.media === false) continue;
      if (!isMedia && prefs.dms === false) continue;

      const body = msgType === 'image' ? '📷 Sent a photo'
                 : msgType === 'video' ? '🎥 Sent a video'
                 : msgText;

      showNotif(msgName, body, msgPfp, docId);
    }
  }
}

// ── Show notification ───────────────────────────────────────────
function showNotif(title, body, icon, tag) {
  self.registration.showNotification(title, {
    body,
    icon: icon || LOGO,
    badge: LOGO,
    tag: 'bytechat-' + tag,
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: APP_URL }
  });
}

// ── Periodic background sync ────────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'bytechat-poll') event.waitUntil(poll());
});

// ── Push fallback ───────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  try {
    const n = event.data.json().notification || {};
    event.waitUntil(self.registration.showNotification(n.title || 'ByteChat', {
      body: n.body || '', icon: n.icon || LOGO, badge: LOGO,
      tag: 'bytechat-push', renotify: true, vibrate: [200, 100, 200],
      data: { url: APP_URL }
    }));
  } catch(e) {}
});
