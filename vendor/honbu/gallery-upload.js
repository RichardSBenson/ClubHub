/*
 * Gallery upload, one picture at a time.
 *
 * Without this script the form still works: the browser sends everything in one go.
 * With it, each picture is shrunk first (a phone photo is 3-6 MB and a web page needs a fraction of
 * that) and sent on its own, so a long list never runs into the host's upload size limit, and one
 * that fails does not take the rest with it.
 * It is a file served from this site, never inline, so the page's Content-Security-Policy is unchanged.
 */
(function () {
  var form = document.querySelector('form[data-gallery-upload]');
  var input = form && form.querySelector('input[type=file]');
  var list = document.getElementById('upload-progress');
  var finish = document.getElementById('upload-finish');
  if (!form || !input || !list || !finish || !window.fetch || !window.FormData) return;

  var LONG_EDGE = 2000, KEEP_UNDER = 1.5 * 1024 * 1024, SEND_UNDER = 4 * 1024 * 1024;

  function toBlob(canvas, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
  }

  // Shrink a big photo to something a web page needs. Anything we cannot read is sent as it is.
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return file;
    try {
      var bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      var long = Math.max(bmp.width, bmp.height);
      if (long <= LONG_EDGE && file.size <= KEEP_UNDER) { bmp.close && bmp.close(); return file; }
      var edge = LONG_EDGE;
      for (var attempt = 0; attempt < 3; attempt++) {
        var scale = Math.min(1, edge / long);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        var blob = await toBlob(canvas, attempt === 0 ? 0.85 : 0.72);
        if (blob && blob.size <= SEND_UNDER) {
          bmp.close && bmp.close();
          return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
        }
        edge = Math.round(edge * 0.75);
      }
      bmp.close && bmp.close();
    } catch (e) { /* fall through: send the original */ }
    return file;
  }

  function say(li, text, cls) { li.textContent = text; li.className = cls || ''; }

  form.addEventListener('submit', async function (ev) {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;                 // a picture chosen from the library: let the page send it
    ev.preventDefault();
    var button = form.querySelector('button[type=submit]');
    if (button) button.disabled = true;
    list.innerHTML = '';
    var csrf = form.querySelector('input[name=_csrf]').value;
    var year = (form.querySelector('[name=year]') || {}).value || '';
    var eventId = (form.querySelector('[name=eventId]') || {}).value || '';
    var caption = files.length === 1 ? ((form.querySelector('[name=caption]') || {}).value || '') : '';
    var alt = (form.querySelector('[name=alt_text]') || {}).value || '';
    var done = 0, failed = 0;

    var rows = files.map(function (f) {
      var li = document.createElement('li'); say(li, f.name + ' — waiting'); list.appendChild(li); return li;
    });
    for (var i = 0; i < files.length; i++) {
      say(rows[i], files[i].name + ' — preparing…');
      var fd = new FormData();
      try {
        var small = await shrink(files[i]);
        fd.append('_csrf', csrf); fd.append('year', year); fd.append('eventId', eventId);
        fd.append('caption', caption); fd.append('alt_text', alt);
        fd.append('file', small, small.name);
        say(rows[i], files[i].name + ' — sending…');
        var res = await fetch(form.action, { method: 'POST', body: fd, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        var body = null;
        try { body = await res.json(); } catch (e) { /* not JSON: the host refused it */ }
        if (res.ok && body && body.ok) { done++; say(rows[i], files[i].name + ' — added', 'ok'); }
        else { failed++; say(rows[i], files[i].name + ' — ' + ((body && body.message) || (res.status === 413 ? 'too large for the host' : 'could not be added')), 'bad'); }
      } catch (e) { failed++; say(rows[i], files[i].name + ' — ' + 'could not be sent', 'bad'); }
    }
    var summary = document.createElement('li');
    say(summary, done + ' added' + (failed ? ', ' + failed + ' not added' : '') + '.', failed ? 'bad' : 'ok');
    list.appendChild(summary);
    if (done) {
      // One rebuild for the whole batch.
      finish.hidden = false;
      var go = finish.querySelector('button');
      if (go) go.focus();
    } else if (button) button.disabled = false;
  });
})();
