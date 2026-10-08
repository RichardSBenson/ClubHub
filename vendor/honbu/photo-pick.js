/* Tapping the photograph (or its initials) opens the file chooser, and choosing a file sends it.
   Where somebody has to agree to the photograph first (a child's), it waits for that tick instead.
   Without this script the ordinary "Choose file" and "Save photograph" buttons do the same job. */
(function () {
  var input = document.querySelector('input[type=file][data-photo]');
  if (!input) return;
  var form = input.form;
  var pick = document.querySelectorAll('.idphoto');
  Array.prototype.forEach.call(pick, function (el) {
    el.style.cursor = 'pointer';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Change the photograph');
    el.addEventListener('click', function () { input.click(); });
    el.removeAttribute('aria-hidden');
    var who = el.parentNode && el.parentNode.querySelector('.idwho');
    if (who && !who.querySelector('.photo-cue')) {
      var cue = document.createElement('small');
      cue.className = 'photo-cue';
      cue.textContent = 'Tap the photo to change it';
      cue.style.cssText = 'display:block;font-size:.8rem;color:#666';
      who.appendChild(cue);
    }
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  });
  input.addEventListener('change', function () {
    if (!input.files || !input.files.length) return;
    var consent = form.querySelector('input[name=consent]');
    if (consent && !consent.checked) {
      var note = document.getElementById('photo-wait');
      if (note) note.hidden = false;
      consent.focus();
      form.scrollIntoView({ block: 'center' });
      return;
    }
    form.submit();
  });
  var consent = form.querySelector('input[name=consent]');
  if (consent) consent.addEventListener('change', function () {
    if (consent.checked && input.files && input.files.length) form.submit();
  });
})();
