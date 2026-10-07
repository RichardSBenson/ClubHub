/* "Select everyone shown" for the instructor picker. Without this script the link beside it does the same on a
   fresh page load. */
(function () {
  var all = document.getElementById('pickall');
  if (!all) return;
  var boxes = Array.prototype.slice.call(document.querySelectorAll('input.pick'));
  all.hidden = false;
  var label = document.querySelector('label[for="pickall"]'); if (label) label.hidden = false;
  var link = document.getElementById('pickall-link'); if (link) link.hidden = true;
  all.addEventListener('change', function () { boxes.forEach(function (b) { b.checked = all.checked; }); });
})();
