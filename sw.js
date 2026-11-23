// Henry Vocab – service worker: nhận thông báo nhắc từ.
// Thông báo đẩy không mang nội dung; khi nhận, hỏi Supabase nội dung lần nhắc gần nhất của máy này.
// Địa chỉ Supabase và khóa công khai được truyền qua tham số lúc đăng ký (?u=...&k=...).
const params = new URL(self.location).searchParams;
const API_URL = (params.get('u') || '').replace(/\/+$/, '') + '/rest/v1/rpc/api';
const API_KEY = params.get('k') || '';
const LANG_FLAGS = { en: '🇬🇧', zh: '🇨🇳' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

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
