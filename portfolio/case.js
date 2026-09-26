// BhuKosh case study — reading UX: progress bar + section rail.
// Vanilla JS, no dependencies. Both elements are inert without JS.
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fill = document.getElementById("read-progress-fill");
  var rail = document.querySelector(".cs-rail");
  var spyLinks = rail ? Array.prototype.slice.call(rail.querySelectorAll("[data-spy]")) : [];

  // ---------- scroll progress ----------
  // A single style write per scroll event — cheaper than any throttling.
  // Width (not transform) keeps the bar exact at every document ratio/DPI.
  function updateProgress() {
    if (!fill) return;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var u = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
    fill.style.width = (u * 100).toFixed(2) + "%";
  }

  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
  updateProgress();

  // ---------- section spy ----------
  if ("IntersectionObserver" in window && spyLinks.length) {
    var current = "";
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.id;
        if (id === current) return;
        current = id;
        spyLinks.forEach(function (a) {
          a.classList.toggle("active", a.getAttribute("data-spy") === id);
        });
      });
    }, { rootMargin: "-35% 0px -55% 0px" });

    spyLinks.forEach(function (a) {
      var sec = document.getElementById(a.getAttribute("data-spy"));
      if (sec) spy.observe(sec);
    });
  }

  // ---------- rail clicks: respect reduced motion (CSS scroll-behavior) ----------
  // html has scroll-behavior: smooth globally; reduced-motion turns it off in
  // styles.css, so anchor jumps need no JS.
  if (reduced) return;
})();
