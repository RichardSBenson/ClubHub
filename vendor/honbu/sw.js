/* Honbu service worker.
 *
 * It does two things only: show a friendly page when the device is offline, and show push notifications.
 * It deliberately caches nothing else — signed-in pages hold people's personal details and must never sit in a cache. */
var SHELL = 'honbu-shell-v1';

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(['/offline.html', '/icons/icon-192.png']); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;               // everything else goes straight to the network
  e.respondWith(fetch(e.request).catch(function () { return caches.match('/offline.html'); }));
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Honbu', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Honbu').slice(0, 80), {
    body: String(d.body || '').slice(0, 200), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: String(d.url || '/me') } }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/me';
  if (url.charAt(0) !== '/' || url.charAt(1) === '/') url = '/me';        // only ever somewhere on this site
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ('focus' in list[i]) { list[i].navigate(url); return list[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
