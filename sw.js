const LOGO = 'https://raw.githubusercontent.com/epicactsuperplayer/ByteChat/main/Bytestorm%20Logo.png';
const APP_URL = 'https://bytestormchat.vercel.app';
const FIREBASE_PROJECT = 'bytestorm-friebase-server';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// Install + activate immediately
self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

// ── Notification click: open/focus the app ──────────────────────
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

// ── Message from main app: store session info ───────────────────
let session = null; // { uid, name, idToken, prefs }

self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'INIT_SESSION') {
    session = event.data.payload;
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

// ── Polling loop ────────────────────────────────────────────────
let pollTimer = null;
const POLL_INTERVAL = 8000;
const seen = new Set();

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(poll, POLL_INTERVAL);
  poll();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function poll() {
  if (!session) return;
  const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const appVisible = allClients.some(c =>
    c.url.includes('bytestormchat.vercel.app') && c.visibilityState === 'visible'
  );
  if (appVisible) return;

  const { uid, name, idToken, prefs = {} } = session;
  const since = Date.now() - 15000;

  try {
    if (prefs.mentions !== false) {
      await checkCollection('messages', uid, name, idToken, since, false);
    }
    if (prefs.dms !== false || prefs.media !== false) {
      await checkDms(uid, name, idToken, since, prefs);
    }
  } catch(e) {
    if (e.message && e.message.includes('401')) stopPolling();
  }
}

// ── Query global messages for @mentions ─────────────────────────
async function checkCollection(colPath, myUid, myName, idToken, since, isDm) {
  const url = `${FIRESTORE_BASE}/${colPath}?pageSize=20`;
  const res = await fetch(url, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}
  });
  if (!res.ok) throw new Error(res.status.toString());
  const json = await res.json();
  const docs = json.documents || [];

  for (const doc of docs) {
    const fields = doc.fields || {};
    const msgUid  = fields.uid?.stringValue;
    const msgTime = parseInt(fields.time?.integerValue || '0');
    const msgName = fields.name?.stringValue || 'Someone';
    const msgText = fields.text?.stringValue || '';
    const msgType = fields.type?.stringValue || 'text';
    const msgPfp  = fields.pfp?.stringValue || LOGO;
    const docId   = doc.name.split('/').pop();

    if (msgUid === myUid) continue;
    if (msgTime < since) continue;
    if (seen.has(docId)) continue;
    seen.add(docId);

    const mentionedMe  = msgText.toLowerCase().includes(`@${myName.toLowerCase()}`);
    const mentionedAll = msgText.includes('@everyone');
    if (!isDm && !mentionedMe && !mentionedAll) continue;

    const title = isDm ? msgName : `${msgName} mentioned you`;
    const body  = isDm
      ? (msgType === 'image' ? '📷 Sent a photo' : msgType === 'video' ? '🎥 Sent a video' : msgText)
      : msgText;

    showNotif(title, body, msgPfp, docId);
  }
}

// ── Check DM conversations ──────────────────────────────────────
async function checkDms(myUid, myName, idToken, since, prefs) {
  const url = `${FIRESTORE_BASE}/dms?pageSize=30`;
  const res = await fetch(url, {
    headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}
  });
  if (!res.ok) return;
  const json = await res.json();
  const docs = json.documents || [];

  for (const doc of docs) {
    const fields = doc.fields || {};
    if (fields.status?.stringValue !== 'accepted') continue;
    const users = (fields.users?.arrayValue?.values || []).map(v => v.stringValue);
    if (!users.includes(myUid)) continue;

    const dmId = doc.name.split('/').pop();
    const msgsRes = await fetch(`${FIRESTORE_BASE}/dms/${dmId}/messages?pageSize=5`, {
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}
    });
    if (!msgsRes.ok) continue;
    const msgs = (await msgsRes.json()).documents || [];

    for (const mdoc of msgs) {
      const f = mdoc.fields || {};
      const msgUid  = f.uid?.stringValue;
      const msgTime = parseInt(f.time?.integerValue || '0');
      const msgName = f.name?.stringValue || 'Someone';
      const msgText = f.text?.stringValue || '';
      const msgType = f.type?.stringValue || 'text';
      const msgPfp  = f.pfp?.stringValue || LOGO;
      const docId   = mdoc.name.split('/').pop();

      if (msgUid === myUid) continue;
      if (msgTime < since) continue;
      if (seen.has(docId)) continue;
      seen.add(docId);

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

// ── Show a notification ─────────────────────────────────────────
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

// ── Periodic background sync (keeps SW alive in supporting browsers) ──
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
