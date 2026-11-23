// Henry Vocab – service worker: mở app khi mất mạng và nhận thông báo nhắc từ.
// Thông báo đẩy không mang nội dung; khi nhận, hỏi Supabase nội dung lần nhắc gần nhất của máy này.
// Địa chỉ Supabase và khóa công khai được truyền qua tham số lúc đăng ký (?u=...&k=...).
const params = new URL(self.location).searchParams;
const API_URL = (params.get('u') || '').replace(/\/+$/, '') + '/rest/v1/rpc/api';
const API_KEY = params.get('k') || '';
const LANG_FLAGS = { en: '🇬🇧', zh: '🇨🇳' };

// ─── MỞ APP KHI MẤT MẠNG ───
// Chỉ lưu khung app cùng tên miền (trang, manifest, icon). Không bao giờ chặn Supabase hay phát âm.
// Luôn hỏi mạng trước để bản mới deploy có hiệu lực ngay; mạng hỏng hoặc quá chậm mới dùng bản đã lưu.
const SHELL_CACHE = 'henry-shell-v1';
const SHELL_PAGE = new URL('./', self.location).href;
const SHELL_FILES = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png'].map(f => new URL(f, self.location).href);
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE)
    .then(cache => cache.addAll([SHELL_PAGE, ...SHELL_FILES]))
    .catch(() => { })
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('henry-shell-') && n !== SHELL_CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event, req, SHELL_PAGE));
  } else {
    const file = url.origin + url.pathname;
    if (SHELL_FILES.includes(file)) event.respondWith(networkFirst(event, req, file));
  }
});

async function networkFirst(event, req, cacheKey) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(req).then(res => {
    // Chỉ lưu trang trả về bình thường (không lưu lỗi, trang chuyển hướng)
    if (res.ok && res.type === 'basic' && !res.redirected) {
      const copy = res.clone();
      event.waitUntil(cache.put(cacheKey, copy).catch(() => { }));
    }
    return res;
  });
  let timer;
  const slow = new Promise(resolve => { timer = setTimeout(resolve, NETWORK_WAIT_MS); });
  try {
    const res = await Promise.race([network, slow]);
    if (res) return res;
    // Mạng quá chậm: dùng bản đã lưu nếu có, mạng vẫn chạy tiếp để cập nhật cho lần sau
    const saved = await cache.match(cacheKey);
    if (saved) {
      event.waitUntil(network.catch(() => { }));
      return saved;
    }
    return await network;
  } catch (err) {
    const saved = await cache.match(cacheKey);
    if (saved) return saved;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('push', event => event.waitUntil(showNudge()));

async function showNudge() {
  let title = 'Henry Vocab – Đến giờ ôn từ';
  let body = 'Mở app để ôn nhanh bộ từ hôm nay.';
  let url = '/';
  try {
    const sub = await self.registration.pushManager.getSubscription();
    const headers = { 'Content-Type': 'application/json', apikey: API_KEY };
    if (API_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + API_KEY;
    const res = await fetch(API_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'pushInbox', payload: { endpoint: sub ? sub.endpoint : '' } })
    });
    const json = await res.json();
    const data = json && json.success ? json.data : null;
    if (data && Array.isArray(data.items) && data.items.length) {
      title = data.title || title;
      const multi = new Set(data.items.map(i => i.lang)).size > 1;
      body = data.items.map(i => `${multi ? (LANG_FLAGS[i.lang] || '') + ' ' : ''}${i.word} – ${i.meaning}`).join('\n');
      url = '/?lang=' + (data.lang || 'en');
    }
  } catch (e) {
    // Mất mạng: vẫn phải hiện thông báo
  }
  return self.registration.showNotification(title, {
    body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'henry-nudge', renotify: true, data: { url }
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
