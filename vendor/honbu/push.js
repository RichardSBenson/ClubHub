/* The "turn on notifications for this device" button on /me/notifications. */
(function () {
  var box = document.getElementById('push-box');
  if (!box) return;
  var on = document.getElementById('push-on'), off = document.getElementById('push-off'), say = document.getElementById('push-msg');
  var key = box.getAttribute('data-key'), csrf = box.getAttribute('data-csrf');
  function note(t) { say.textContent = t; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    on.hidden = true;
    note('This browser cannot receive notifications. On an iPhone or iPad, choose Share, then Add to Home Screen, and open it from there.');
    return;
  }
  function bytes(s) {
    var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function post(path, data) {
    var body = new URLSearchParams(Object.assign({ _csrf: csrf }, data));
    return fetch(path, { method: 'POST', body: body, credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  }
  function show(has) { on.hidden = has; off.hidden = !has; }
  navigator.serviceWorker.ready.then(function (reg) {
    reg.pushManager.getSubscription().then(function (sub) { show(!!sub); });
    on.addEventListener('click', function () {
      note('One moment…');
      Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') { note('Notifications are blocked for this site. Allow them in your browser settings, then try again.'); return; }
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) }).then(function (sub) {
          var j = sub.toJSON();
          return post('/push/subscribe', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }).then(function (r) {
            if (r.ok) { show(true); note('Done. This device will now get notifications.'); } else { note('That did not work. Please try again.'); }
          });
        });
      }).catch(function () { note('That did not work. Please try again.'); });
    });
    off.addEventListener('click', function () {
      reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) { show(false); return; }
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () { return post('/push/unsubscribe', { endpoint: endpoint }); }).then(function () { show(false); note('Notifications are off for this device.'); });
      });
    });
  });
})();
