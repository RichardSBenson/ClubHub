/* The app on a phone or tablet.
 *
 *   - registers the service worker (sw.js says what it keeps)
 *   - says so when there is no connection
 *   - keeps a member's card and a club's class roll ready for a hall with no signal
 *   - holds a roll taken offline on the device and sends it when the signal returns
 *   - offers to install the app
 *   - empties what the device kept when somebody signs out
 */
(function () {
  var DEVICE = 'honbu-device';
  var KEEP = [/^\/me\/[0-9a-f-]{36}\/card$/, /^\/me\/events$/, /^\/o\/[a-z0-9-]+\/attendance(\/[0-9a-f-]{36})?$/];
  var ROLL_POST = /^\/o\/[a-z0-9-]+\/attendance\/[0-9a-f-]{36}$/;
  var online = true;

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in (attrs || {})) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }
  function style() {
    if (document.getElementById('honbu-pwa-css')) return;
    var s = el('style', { id: 'honbu-pwa-css' });
    s.textContent = '.pwa-bar{position:fixed;left:0;right:0;bottom:0;z-index:50;padding:10px 16px;background:#1c2333;color:#fff;' +
      'font:14px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;' +
      'padding-bottom:calc(10px + env(safe-area-inset-bottom))}.pwa-bar button{font:inherit;padding:6px 12px;border:0;border-radius:6px;' +
      'background:#fff;color:#1c2333;cursor:pointer}.pwa-bar.warn{background:#8a4b00}.pwa-install{margin:0 0 0 12px;font:inherit;' +
      'padding:4px 10px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer}';
    document.head.appendChild(s);
  }

  // ---- the service worker --------------------------------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
    });
  }

  // ---- offline notice -------------------------------------------------------------------------------------------
  var offlineBar = null;
  function showOffline(on) {
    online = !on;
    style();
    if (on && !offlineBar) {
      offlineBar = el('div', { class: 'pwa-bar', role: 'status' }, 'You are offline. You can still use your card, see your upcoming events and take the class roll; anything else needs a connection.');
      document.body.appendChild(offlineBar);
    } else if (!on && offlineBar) { offlineBar.remove(); offlineBar = null; }
  }
  window.addEventListener('offline', function () { showOffline(true); });
  window.addEventListener('online', function () { showOffline(false); flush(); });
  if (navigator.onLine === false) document.addEventListener('DOMContentLoaded', function () { showOffline(true); });

  /** A real answer from our own server, not just "the wifi is on". */
  function reachable() {
    if (navigator.onLine === false) return Promise.resolve(false);
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 3500);
    return fetch('/icons/icon-192.png?probe=' + Date.now(), { method: 'HEAD', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(timer); return r.ok || r.status < 500; })
      .catch(function () { clearTimeout(timer); return false; });
  }

  // ---- ready for a hall with no signal -------------------------------------------------------------------------
  function warm() {
    if (!('caches' in window) || navigator.onLine === false) return;
    var seen = {}, links = document.querySelectorAll('a[href]');
    var todo = [];
    for (var i = 0; i < links.length; i++) {
      var u;
      try { u = new URL(links[i].getAttribute('href'), location.href); } catch (x) { continue; }
      if (u.origin !== location.origin || seen[u.pathname + u.search]) continue;
      if (!KEEP.some(function (re) { return re.test(u.pathname); })) continue;
      seen[u.pathname + u.search] = 1; todo.push(u.href);
      if (todo.length >= 12) break;
    }
    if (!todo.length) return;
    caches.open(DEVICE).then(function (c) {
      todo.forEach(function (href) {
        fetch(href, { credentials: 'same-origin' }).then(function (r) {
          if (r.ok && !r.redirected) c.put(href, r.clone());
        }).catch(function () {});
      });
    });
  }
  window.addEventListener('load', function () { setTimeout(warm, 800); });

  // ---- the outbox: a roll taken with no signal ------------------------------------------------------------------
  function db() {
    return new Promise(function (res, rej) {
      if (!('indexedDB' in window)) return rej(new Error('no storage'));
      var r = indexedDB.open('honbu-outbox', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('rolls', { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('rolls', mode), s = t.objectStore('rolls'), out = fn(s);
        t.oncomplete = function () { res(out && out.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var queued = function () { return tx('readonly', function (s) { return s.getAll(); }); };
  var queue = function (item) { return tx('readwrite', function (s) { return s.add(item); }); };
  var drop = function (id) { return tx('readwrite', function (s) { return s.delete(id); }); };

  var outBar = null;
  function showOutbox(items) {
    style();
    if (outBar) { outBar.remove(); outBar = null; }
    if (!items.length) return;
    outBar = el('div', { class: 'pwa-bar warn', role: 'status' });
    outBar.appendChild(el('span', {}, items.length + (items.length === 1 ? ' class roll is' : ' class rolls are') +
      ' saved on this device and not sent yet.'));
    var b = el('button', { type: 'button' }, 'Send now');
    b.onclick = function () { flush(true); };
    outBar.appendChild(b);
    document.body.appendChild(outBar);
  }
  function refreshOutbox() { return queued().then(showOutbox).catch(function () {}); }

  var flushing = false;
  function flush(loud) {
    if (flushing) return Promise.resolve();
    flushing = true;
    return queued().then(function (items) {
      return items.reduce(function (p, it) {
        return p.then(function () {
          return fetch(it.action, { method: 'POST', credentials: 'same-origin', redirect: 'manual',
            headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: it.body })
            .then(function (r) {
              // A redirect is the server saying "saved". A refusal stays queued so nothing is lost silently.
              if (r.type === 'opaqueredirect' || (r.status >= 200 && r.status < 400)) return drop(it.id);
              if (loud) alert('The server did not accept a saved roll (' + r.status + '). Sign in again, then press Send now.');
            });
        });
      }, Promise.resolve());
    }).catch(function () { if (loud) alert('Still no connection. The roll is safe on this device.'); })
      .then(function () { flushing = false; return refreshOutbox(); })
      .then(function () { if (loud && !outBar) { style(); var ok = el('div', { class: 'pwa-bar', role: 'status' }, 'Sent. The rolls are saved.'); document.body.appendChild(ok); setTimeout(function () { ok.remove(); }, 3500); } });
  }

  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!f || !f.getAttribute) return;
    var action = f.getAttribute('action') || '';
    var path; try { path = new URL(action, location.href).pathname; } catch (x) { return; }

    // Signing out: empty what the device kept, and do not lose a roll that has not been sent.
    if (path === '/signout') {
      if (outBar && !confirm('A class roll saved on this device has not been sent yet. Sign out anyway?')) { ev.preventDefault(); return; }
      if ('caches' in window) caches.delete(DEVICE);
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('purge');
      return;
    }

    if (!ROLL_POST.test(path) || (f.method || '').toLowerCase() !== 'post') return;
    ev.preventDefault();
    var body = new URLSearchParams(new FormData(f)).toString();
    var go = function () { HTMLFormElement.prototype.submit.call(f); };
    reachable().then(function (up) {
      if (up) return go();
      queue({ action: path, body: body, at: Date.now() }).then(function () {
        refreshOutbox();
        window.scrollTo(0, 0);
        var note = el('div', { class: 'note', role: 'status' }, 'Saved on this device. It will be sent as soon as there is a connection.');
        f.parentNode.insertBefore(note, f);
      }).catch(go);
    });
  }, true);

  window.addEventListener('load', function () { refreshOutbox(); if (navigator.onLine !== false) flush(); });

  // ---- installing ----------------------------------------------------------------------------------------------
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var asked = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); asked = e;
    var foot = document.querySelector('.foot');
    if (!foot || standalone || foot.querySelector('.pwa-install')) return;
    var b = el('button', { type: 'button', class: 'pwa-install' }, 'Install the app');
    b.onclick = function () { asked.prompt(); asked.userChoice.then(function () { b.remove(); asked = null; }); };
    foot.appendChild(b);
  });
  window.addEventListener('appinstalled', function () { var b = document.querySelector('.pwa-install'); if (b) b.remove(); });
  document.addEventListener('DOMContentLoaded', function () {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    var foot = document.querySelector('.foot');
    if (ios && !standalone && foot) foot.appendChild(el('span', { class: 'muted', style: 'margin-left:12px' },
      'To install: tap Share, then Add to Home Screen.'));
  });
})();
