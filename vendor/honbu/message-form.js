/* The compose screen shows only the part of the form that matches who the message is for. Without this script every
   part is shown, each under its own label, and the form still works. */
(function () {
  var who = document.getElementById('audience');
  if (!who) return;
  var parts = Array.prototype.slice.call(document.querySelectorAll('#compose [data-for]'));
  function show() {
    parts.forEach(function (p) { p.hidden = p.getAttribute('data-for') !== who.value; });
  }
  who.addEventListener('change', show);
  show();
})();
