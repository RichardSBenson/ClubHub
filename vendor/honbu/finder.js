/* The "find your nearest dojo" box on the home page. Without this script the Go button is an
   ordinary link to the list of every dojo, so nothing is lost if it does not run. */
(function () {
  var select = document.querySelector('select[data-finder]');
  var go = document.querySelector('a[data-finder-go]');
  if (!select) return;
  // Only an address on this site. The values are written by the build, but a page is not the place to trust that.
  function ok(v) { return typeof v === 'string' && v.charAt(0) === '/' && v.charAt(1) !== '/'; }
  select.addEventListener('change', function () { if (ok(select.value)) window.location.href = select.value; });
  if (go) go.addEventListener('click', function (e) {
    if (ok(select.value)) { e.preventDefault(); window.location.href = select.value; }
  });
})();
