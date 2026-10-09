/* Shows the day of the week under every date box ("Saturday 17 October 2026"), updating as the date changes.
   Without this script the date boxes work exactly as before, just without the day name. */
(function () {
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function words(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (isNaN(d) || d.getUTCMonth() !== +m[2] - 1) return '';
    return DAYS[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[type=date], input[type=datetime-local]'), function (input) {
    var out = document.createElement('small');
    out.className = 'day-of-week';
    out.setAttribute('aria-live', 'polite');
    out.style.cssText = 'display:block;margin-top:4px;font-weight:600';
    input.parentNode.insertBefore(out, input.nextSibling);
    var show = function () { out.textContent = words(input.value); };
    input.addEventListener('input', show);
    input.addEventListener('change', show);
    show();
  });
})();
