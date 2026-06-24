// Smooth-scroll navigation (respects prefers-reduced-motion)
(function () {
  var HEADER_OFFSET = 80;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function scrollToId(id) {
    var behavior = reduceMotion ? 'auto' : 'smooth';
    if (id === 'top') {
      window.scrollTo({ top: 0, behavior: behavior });
      return;
    }
    var el = document.getElementById(id);
    if (!el) return;
    var top = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
    window.scrollTo({ top: top, behavior: behavior });
  }

  document.querySelectorAll('[data-scroll]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      scrollToId(btn.getAttribute('data-scroll'));
    });
  });
})();
