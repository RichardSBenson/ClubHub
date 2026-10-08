/* Photo viewer for gallery pictures. Without this script each picture is a plain
   link to the full-size file, so nothing is lost if it does not run. */
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.gallery a.glink, .gal a.glink'));
  if (!links.length) return;
  var box, img, cap, count, at = 0, last = null;

  function build() {
    box = document.createElement('div');
    box.className = 'lb'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Photo viewer');
    function btn(cls, label, text, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lb-btn ' + cls; b.setAttribute('aria-label', label); b.textContent = text;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      return b;
    }
    img = document.createElement('img'); img.className = 'lb-img'; img.alt = '';
    cap = document.createElement('p'); cap.className = 'lb-cap';
    count = document.createElement('span'); count.className = 'lb-count';
    box.appendChild(btn('lb-close', 'Close', '×', close));
    box.appendChild(btn('lb-prev', 'Previous photo', '‹', function () { show(at - 1); }));
    box.appendChild(btn('lb-next', 'Next photo', '›', function () { show(at + 1); }));
    box.appendChild(img); box.appendChild(cap); box.appendChild(count);
    box.addEventListener('click', close);
    img.addEventListener('click', function (e) { e.stopPropagation(); show(at + 1); });
    var x0 = null;
    box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
    });
    document.body.appendChild(box);
  }

  function show(i) {
    at = (i + links.length) % links.length;
    var a = links[at], pic = a.querySelector('img');
    img.src = a.getAttribute('href');
    img.alt = pic ? pic.alt : '';
    var fc = a.parentNode.querySelector('figcaption');
    cap.textContent = fc ? fc.textContent : '';
    cap.hidden = !fc;
    count.textContent = (at + 1) + ' / ' + links.length;
    var many = links.length > 1;
    box.querySelector('.lb-prev').hidden = !many; box.querySelector('.lb-next').hidden = !many;
  }
  function open(i) {
    if (!box) build();
    last = document.activeElement;
    show(i); box.hidden = false;
    document.documentElement.classList.add('lb-open');
    box.querySelector('.lb-close').focus();
  }
  function close() {
    box.hidden = true; img.removeAttribute('src');
    document.documentElement.classList.remove('lb-open');
    if (last && last.focus) last.focus();
  }

  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault(); open(i);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (!box || box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(at + 1);
    else if (e.key === 'ArrowLeft') show(at - 1);
  });
})();
