// Nav state, scroll reveals, email copy, footer year.
// All defensive: the page must remain usable if any part fails.
(function () {
  "use strict";

  // ----- Sticky nav background -----
  const nav = document.querySelector(".nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ----- Mobile navigation -----
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.getElementById("nav-menu");

  function closeMenu() {
    if (!toggle || !menu) return;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
    menu.classList.remove("open");
    document.body.classList.remove("nav-locked");
  }

  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      toggle.setAttribute("aria-label", open ? "Open menu" : "Close menu");
      menu.classList.toggle("open", !open);
      document.body.classList.toggle("nav-locked", !open);
    });

    // close on link click and on Escape
    menu.addEventListener("click", (e) => {
      if (e.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        closeMenu();
        toggle.focus();
      }
    });

    // reset state if resized back to desktop
    window.matchMedia("(min-width: 761px)").addEventListener("change", (mq) => {
      if (mq.matches) closeMenu();
    });
  }

  // ----- Active section link (desktop) -----
  const links = [...document.querySelectorAll(".nav-links a")];
  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          links.forEach((a) =>
            a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id)
          );
        });
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    sections.forEach((s) => spy.observe(s));
  }

  // ----- Scroll reveals -----
  // Above-fold elements must never be reveal-gated: they ARE the LCP
  // element. Everything at load-time below the fold observes as normal.
  const reveals = [...document.querySelectorAll(".reveal")];
  reveals.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.7 && r.bottom > 0) el.classList.add("is-visible");
  });
  const pendingReveals = reveals.filter((el) => !el.classList.contains("is-visible"));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    pendingReveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  // ----- Email copy (button copies; mailto link remains as fallback) -----
  const emailBtn = document.querySelector(".email-copy");
  if (emailBtn) {
    const confirmEl = emailBtn.querySelector(".email-confirm");
    const idleText = confirmEl ? confirmEl.dataset.idle || "Click to copy" : "";
    let resetTimer = null;

    const showConfirm = () => {
      emailBtn.classList.add("copied");
      if (confirmEl) confirmEl.textContent = "Copied ✓";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        emailBtn.classList.remove("copied");
        if (confirmEl) confirmEl.textContent = idleText;
      }, 2000);
    };

    const legacyCopy = (text) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      ta.remove();
    };

    emailBtn.addEventListener("click", async () => {
      const text = emailBtn.dataset.email || emailBtn.querySelector(".email-text")?.textContent || "";
      if (!text) return;
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); } catch { legacyCopy(text); }
      } else {
        legacyCopy(text);
      }
      showConfirm();
    });
  }

  // ----- Magnetic primary CTA -----
  // Selective tactility: only the hero's solid CTA leans toward the
  // pointer, and only where a fine pointer exists (mouse/trackpad). Touch
  // and keyboard users see a plain button; reduced motion opts out.
  const cta = document.querySelector(".hero-cta .btn-solid");
  if (
    cta &&
    window.matchMedia("(pointer: fine)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    const STRENGTH = 0.22;   // fraction of the offset the button follows
    const MAX_SHIFT = 7;     // px — enough to feel, too little to misalign
    let raf = 0, tx = 0, ty = 0;

    const apply = () => {
      raf = 0;
      // the base .btn transition would lag per-frame tracking — only the
      // pointerleave spring-back animates
      cta.style.transition = "none";
      cta.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
    };

    cta.addEventListener("pointermove", (e) => {
      const r = cta.getBoundingClientRect();
      tx = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, (e.clientX - r.left - r.width / 2) * STRENGTH));
      ty = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, (e.clientY - r.top - r.height / 2) * STRENGTH));
      if (!raf) raf = requestAnimationFrame(apply);
    });
    cta.addEventListener("pointerleave", () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      tx = 0; ty = 0;
      cta.style.transition = "transform 0.4s cubic-bezier(0.22, 0.61, 0.36, 1)";
      cta.style.transform = "translate(0, 0)";
      setTimeout(() => { cta.style.transition = ""; }, 420);
    });
  }

  // ----- Hidden editor trigger -----
  // The nav brand mark (dot) is the only hint. 5 clicks within 3 seconds on
  // the brand opens /admin/. Obscurity is NOT security — the editor still
  // requires server-side authentication; this only saves the URL a keystroke.
  var brand = document.querySelector(".brand");
  if (brand) {
    var clicks = 0;
    var timer = null;
    brand.addEventListener("click", function (e) {
      if (!e.target.closest(".brand span")) return; // only the accent dot
      e.preventDefault();
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(function () {
        clicks = 0;
      }, 3000);
      if (clicks >= 5) {
        clicks = 0;
        window.location.href = "/admin/";
      }
    });
  }

  // ----- Footer year -----
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
