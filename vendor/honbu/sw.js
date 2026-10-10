/* Honbu service worker.
 *
 * What it keeps, and why that is safe:
 *
 *   1. THE SHELL. The offline page, the icons and the two small scripts. Nothing personal.
 *   2. PUBLIC PAGES. A page the server did not mark private or no-store (the club and event pages anybody can read) is
 *      kept so it still opens with no signal. Each visit refreshes it.
 *   3. THREE SIGNED-IN PAGES, ON PURPOSE. A member's own membership card, their list of upcoming events, and a club's
 *      class roll. Those are what must work in a hall or a car park with no reception. They live in their own cache that is emptied on sign-out
 *      (pwa.js sends 'purge'), and nothing else signed-in is ever stored.
 *
 * Everything else signed-in goes straight to the network and, with no signal, shows the offline page.
 */
var VERSION = 'v2';
var SHELL = 'honbu-shell-' + VERSION;
var PAGES = 'honbu-pages-' + VERSION;
var DEVICE = 'honbu-device';                       // not versioned: an update must not throw away a saved roll
var MAX_PAGES = 40;

var SHELL_FILES = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-96.png', '/vendor/pwa.js', '/vendor/push.js'];

/* The only signed-in pages the device may keep. */
var KEEP = [/^\/me\/[0-9a-f-]{36}\/card$/, /^\/me\/events$/, /^\/o\/[a-z0-9-]+\/attendance(\/[0-9a-f-]{36})?$/];
var keepOnDevice = function (url) { return KEEP.some(function (re) { return re.test(url.pathname); }); };

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    // One missing file must not stop the app installing, so these are added one at a time.
    return Promise.all(SHELL_FILES.map(function (f) { return c.add(f).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== PAGES && k !== DEVICE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.registration.navigationPreload && self.registration.navigationPreload.enable(); })
    .then(function () { return self.clients.claim(); }));
});

function trim(cache) {
  return cache.keys().then(function (keys) {
    return Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PAGES)).map(function (k) { return cache.delete(k); }));
  });
}

function isPrivate(res) { return /no-store|private/i.test(res.headers.get('cache-control') || ''); }

function navigate(e) {
  var url = new URL(e.request.url);
  var keep = keepOnDevice(url);
  return Promise.resolve(e.preloadResponse).then(function (pre) { return pre || fetch(e.request); }).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      // A sign-in redirect arrives as a redirected response; that is not the roll or the card, so it is not kept.
      if (keep && !res.redirected) { var copy = res.clone(); e.waitUntil(caches.open(DEVICE).then(function (c) { return c.put(e.request, copy); })); }
      else if (!keep && !isPrivate(res)) { var pub = res.clone(); e.waitUntil(caches.open(PAGES).then(function (c) { return c.put(e.request, pub).then(function () { return trim(c); }); })); }
    }
    return res;
  }).catch(function () {
    return (keep ? caches.open(DEVICE).then(function (c) { return c.match(e.request); }) : caches.open(PAGES).then(function (c) { return c.match(e.request); }))
      .then(function (hit) { return hit || caches.match('/offline.html'); });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') return e.respondWith(navigate(e));
  // Icons, scripts and images that never change by person: answer from the shell cache, else the network.
  if (/^\/(icons|vendor|media)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
        return res;
      });
      net.catch(function () {});
      return hit || net;
    }).catch(function () { return caches.match(req); }));
  }
});

self.addEventListener('message', function (e) {
  if (e.data === 'purge') e.waitUntil(caches.delete(DEVICE));          // signing out empties what the device kept
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Honbu', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Honbu').slice(0, 80), {
    body: String(d.body || '').slice(0, 200), icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url: String(d.url || '/me') } }));
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
