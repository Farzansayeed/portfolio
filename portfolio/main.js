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
  const reveals = [...document.querySelectorAll(".reveal")];
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
    reveals.forEach((el) => io.observe(el));
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
