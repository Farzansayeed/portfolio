// Spatial Command Navigation — one controller, many surfaces.
//
//   SectionObserver   IntersectionObserver over the page's sections; the
//                     single source of truth, broadcast as nav:section.
//   DesktopRail       right-edge vertical instrument (≥1100px): active
//                     section dominant, neighbors quiet, condenses on
//                     scroll-down, re-expands on scroll-up, ⌘K chip.
//   MobileBar         bottom adaptive bar (<760px): current section + ⌘K,
//                     recedes on scroll-down, returns on scroll-up, opens
//                     the section sheet.
//   CommandPalette    Ctrl/⌘K: fuzzy-filtered jump list over sections,
//                     projects, case studies, and external destinations;
//                     full keyboard model, focus restore on close.
//   DotSurface        the brand dot becomes a hover/click control point —
//                     a compact menu that keeps the 5-click admin trigger
//                     intact (admin is never listed here).
//   Atmosphere        nav:section subtly modulates the orb field's speed —
//                     atmosphere reacts, it never navigates.
//
// No dependencies. No layout takeover: the old top navbar, footer links,
// and every conventional path remain. Reduced motion: state changes become
// instant, hide/show behavior stays but without transitions.
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ============================================================
  // CONFIG — one source of truth for every surface
  // ============================================================

  var SECTIONS = [
    { id: "about",        label: "About" },
    { id: "projects",     label: "Projects" },
    { id: "skills",       label: "Skills" },
    { id: "achievements", label: "Achievements" },
    { id: "contact",      label: "Contact" },
  ];

  var PROJECTS = [
    { label: "BhuKosh",     hint: "Case study",    href: "bhukosh.html" },
    { label: "WikiExplore", hint: "Case study",    href: "wikiexplore.html" },
    { label: "WikiExplore live", hint: "Live site", href: "https://wiki-explore.vercel.app", external: true },
  ];

  var EXTERNALS = [
    { label: "GitHub",      hint: "External", href: "https://github.com/Farzansayeed" },
    { label: "LinkedIn",    hint: "External", href: "https://www.linkedin.com/in/farzan-sayeed-hashmi-b9876539b/" },
    { label: "Résumé",      hint: "PDF",      href: "resume.pdf" },
    { label: "Email",       hint: "Mail",     href: "mailto:farzansayeedhashmi@gmail.com" },
  ];

  // ============================================================
  // SECTION OBSERVER — single source of truth
  // ============================================================

  function SectionObserver(onChange) {
    var current = "";
    var sections = SECTIONS
      .map(function (s) { return document.getElementById(s.id); })
      .filter(Boolean);

    function emit(id) {
      if (id === current) return;
      current = id;
      onChange(id);
      document.dispatchEvent(new CustomEvent("nav:section", { detail: { id: id } }));
    }

    if ("IntersectionObserver" in window && sections.length) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) emit(e.target.id);
        });
      }, { rootMargin: "-40% 0px -55% 0px" });
      sections.forEach(function (s) { spy.observe(s); });
    }

    emit(sections.length ? sections[0].id : "");
    return {
      get: function () { return current; },
      jump: function (id) {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      },
    };
  }

  // ============================================================
  // SCROLL DIRECTION — shared by desktop rail + mobile bar
  // ============================================================

  function ScrollDirection(onFlip) {
    var lastY = window.scrollY;
    var down = false;
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var y = window.scrollY;
        var delta = y - lastY;
        if (Math.abs(delta) > 6 && y > 140) {
          var nowDown = delta > 0;
          if (nowDown !== down) {
            down = nowDown;
            onFlip(down);
          }
          lastY = y;
        } else if (y <= 140 && down) {
          down = false;
          onFlip(false);
        }
      });
    }, { passive: true });
  }

  // ============================================================
  // DESKTOP RAIL — right-edge vertical instrument (≥1100px)
  // ============================================================

  function DesktopRail(observer) {
    // Both surfaces always render; CSS decides visibility per breakpoint.
    // This keeps phone/tablet rotation and window resizing working without
    // rebuild logic — one DOM, two presentations.
    var host = document.createElement("nav");
    host.className = "navrail" + (reduced ? " no-anim" : "");
    host.setAttribute("aria-label", "Section navigation");
    host.innerHTML =
      '<button type="button" class="navrail-kbd" aria-label="Open command palette (Ctrl K)">' +
        '<span class="navrail-kbd-key">⌘K</span>' +
      "</button>" +
      '<ul class="navrail-list">' +
        SECTIONS.map(function (s) {
          return '<li><a class="navrail-item" href="#' + s.id + '" data-section="' + s.id + '">' +
            '<span class="navrail-dot" aria-hidden="true"></span>' +
            '<span class="navrail-label">' + s.label + "</span></a></li>";
        }).join("") +
      "</ul>";

    var items = {};
    host.querySelectorAll("[data-section]").forEach(function (a) {
      items[a.getAttribute("data-section")] = a;
      a.addEventListener("click", function (e) {
        e.preventDefault();
        observer.jump(a.getAttribute("data-section"));
      });
      a.addEventListener("focus", function () { wake(); });
    });

    var kbdBtn = host.querySelector(".navrail-kbd");
    kbdBtn.addEventListener("click", function () { Palette.open(); });

    function paint(id) {
      Object.keys(items).forEach(function (k) {
        var a = items[k];
        a.classList.toggle("is-active", k === id);
        if (k === id) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }

    // condense on scroll-down, re-expand on scroll-up
    var condensed = false;
    function setCondensed(v) {
      if (v === condensed) return;
      condensed = v;
      host.classList.toggle("is-condensed", v && !host.contains(document.activeElement));
    }
    function wake() { host.classList.remove("is-condensed"); }
    host.addEventListener("pointerenter", wake);
    host.addEventListener("focusin", wake);
    new ScrollDirection(setCondensed);

    observer && paint(observer.get());
    document.addEventListener("nav:section", function (e) { paint(e.detail.id); });
    document.body.appendChild(host);
    return host;
  }

  // ============================================================
  // MOBILE BAR — bottom adaptive instrument (<760px)
  // ============================================================

  function MobileBar(observer) {
    var host = document.createElement("nav");
    host.className = "mbar" + (reduced ? " no-anim" : "");
    host.setAttribute("aria-label", "Section navigation");
    host.innerHTML =
      '<button type="button" class="mbar-sections" aria-haspopup="dialog" aria-label="Open section navigator">' +
        '<span class="mbar-dot" aria-hidden="true"></span>' +
        '<span class="mbar-current">Top</span>' +
      "</button>" +
      '<button type="button" class="mbar-kbd" aria-label="Search (Ctrl K)">' +
        '<span aria-hidden="true">⌘K</span>' +
      "</button>";
    document.body.appendChild(host);

    var current = host.querySelector(".mbar-current");
    function paint(id) {
      var match = SECTIONS.filter(function (s) { return s.id === id; })[0];
      current.textContent = match ? match.label : "Top";
    }
    paint(observer.get());
    document.addEventListener("nav:section", function (e) { paint(e.detail.id); });

    host.querySelector(".mbar-sections").addEventListener("click", function () {
      Sheet.open(observer);
    });
    host.querySelector(".mbar-kbd").addEventListener("click", function () { Palette.open(); });

    var hidden = false;
    new ScrollDirection(function (down) {
      hidden = down;
      host.classList.toggle("is-hidden", down);
    });
    return host;
  }

  // ============================================================
  // MOBILE SHEET — the bar unfolds into the section list
  // ============================================================

  var Sheet = {
    el: null,
    observer: null,
    open: function (observer) {
      Sheet.observer = observer;
      if (!Sheet.el) {
        var d = document.createElement("div");
        d.className = "sheet" + (reduced ? " no-anim" : "");
        d.setAttribute("role", "dialog");
        d.setAttribute("aria-modal", "true");
        d.setAttribute("aria-label", "Sections");
        d.innerHTML =
          '<div class="sheet-backdrop"></div>' +
          '<div class="sheet-panel">' +
            '<ul class="sheet-list">' +
              SECTIONS.map(function (s) {
                return '<li><a href="#' + s.id + '" data-section="' + s.id + '">' +
                  '<span class="sheet-dot" aria-hidden="true"></span>' + s.label + "</a></li>";
              }).join("") +
            "</ul>" +
            '<div class="sheet-foot">Search: <kbd>⌘K</kbd> works here too</div>' +
          "</div>";
        document.body.appendChild(d);
        Sheet.el = d;
        d.querySelector(".sheet-backdrop").addEventListener("click", Sheet.close);
        d.querySelectorAll("[data-section]").forEach(function (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            Sheet.close();
            var id = a.getAttribute("data-section");
            setTimeout(function () { Sheet.observer.jump(id); }, reduced ? 0 : 120);
          });
        });
        d.addEventListener("keydown", function (e) {
          if (e.key === "Escape") Sheet.close();
        });
      }
      Sheet.el.hidden = false;
      document.body.classList.add("nav-locked");
      var first = Sheet.el.querySelector("[data-section]");
      if (first) first.focus();
    },
    close: function () {
      if (!Sheet.el) return;
      Sheet.el.hidden = true;
      document.body.classList.remove("nav-locked");
    },
  };

  // ============================================================
  // COMMAND PALETTE — Ctrl/⌘K
  // ============================================================

  var Palette = {
    el: null, input: null, list: null, items: [], selected: 0, lastFocus: null,

    commands: function () {
      var cmds = [];
      // only sections that exist on this page (home has all five; case
      // studies have none — their rail already maps the document)
      SECTIONS.forEach(function (s) {
        if (!document.getElementById(s.id)) return;
        cmds.push({ label: s.label, hint: "Section", keywords: s.label.toLowerCase(), run: function () { Observer.jump(s.id); } });
      });
      PROJECTS.forEach(function (p) {
        cmds.push({ label: p.label, hint: p.hint, keywords: (p.label + " " + p.hint).toLowerCase(), href: p.href, external: p.external });
      });
      EXTERNALS.forEach(function (x) {
        cmds.push({ label: x.label, hint: x.hint, keywords: (x.label + " " + x.hint).toLowerCase(), href: x.href, external: !x.href.startsWith("mailto:") });
      });
      return cmds;
    },

    build: function () {
      var d = document.createElement("div");
      d.className = "palette" + (reduced ? " no-anim" : "");
      d.setAttribute("role", "dialog");
      d.setAttribute("aria-modal", "true");
      d.setAttribute("aria-label", "Command palette");
      d.innerHTML =
        '<div class="palette-backdrop"></div>' +
        '<div class="palette-panel">' +
          '<input class="palette-input" type="text" placeholder="Search or jump to…" ' +
            'aria-label="Search or jump to" autocomplete="off" spellcheck="false">' +
          '<ul class="palette-list" role="listbox" aria-label="Results"></ul>' +
          '<div class="palette-foot">' +
            "<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>" +
            "<span><kbd>↵</kbd> open</span>" +
            "<span><kbd>esc</kbd> close</span>" +
          "</div>" +
        "</div>";
      document.body.appendChild(d);
      Palette.el = d;
      Palette.input = d.querySelector(".palette-input");
      Palette.list = d.querySelector(".palette-list");

      d.querySelector(".palette-backdrop").addEventListener("click", Palette.close);
      Palette.input.addEventListener("input", Palette.render);
      Palette.list.addEventListener("click", function (e) {
        var li = e.target.closest("[data-idx]");
        if (li) Palette.run(+li.getAttribute("data-idx"));
      });
      d.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); Palette.close(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); Palette.move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); Palette.move(-1); }
        else if (e.key === "Enter") { e.preventDefault(); Palette.run(Palette.selected); }
      });
    },

    open: function () {
      if (!Palette.el) Palette.build();
      Palette.lastFocus = document.activeElement;
      Palette.input.value = "";
      Palette.render();
      Palette.el.hidden = false;
      document.body.classList.add("nav-locked");
      Palette.input.focus();
    },

    close: function () {
      if (!Palette.el || Palette.el.hidden) return;
      Palette.el.hidden = true;
      document.body.classList.remove("nav-locked");
      if (Palette.lastFocus && Palette.lastFocus.focus) Palette.lastFocus.focus();
    },

    render: function () {
      var q = Palette.input.value.trim().toLowerCase();
      function subseq(label, s) {
        var i = -1;
        for (var k = 0; k < s.length; k++) {
          i = label.indexOf(s[k], i + 1);
          if (i === -1) return false;
        }
        return true;
      }
      var cmds = Palette.commands().filter(function (c) {
        var l = c.label.toLowerCase();
        return !q || l.indexOf(q) !== -1 || c.keywords.indexOf(q) !== -1 || subseq(l, q);
      });
      Palette.items = cmds;
      Palette.selected = 0;
      Palette.list.innerHTML = cmds.map(function (c, i) {
        return '<li role="option" aria-selected="' + (i === 0) + '" data-idx="' + i + '"' +
          ' class="palette-item' + (i === 0 ? " is-selected" : "") + '">' +
          "<span>" + c.label + "</span><em>" + c.hint + "</em></li>";
      }).join("") || '<li class="palette-empty">No matches</li>';
    },

    move: function (dir) {
      if (!Palette.items.length) return;
      Palette.selected = (Palette.selected + dir + Palette.items.length) % Palette.items.length;
      Palette.list.querySelectorAll(".palette-item").forEach(function (li, i) {
        li.classList.toggle("is-selected", i === Palette.selected);
        li.setAttribute("aria-selected", String(i === Palette.selected));
      });
      var sel = Palette.list.children[Palette.selected];
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
    },

    run: function (idx) {
      var c = Palette.items[idx];
      if (!c) return;
      Palette.close();
      if (c.run) c.run();
      else if (c.href) {
        if (c.external) window.open(c.href, "_blank", "noopener");
        else window.location.href = c.href;
      }
    },
  };

  // global shortcut — works whether or not any surface rendered
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (Palette.el && !Palette.el.hidden) Palette.close();
      else Palette.open();
    } else if (e.key === "Escape" && Palette.el && !Palette.el.hidden) {
      // belt-and-braces: the dialog also handles Escape from within
      Palette.close();
    }
  });

  // ============================================================
  // DOT SURFACE — the brand dot as control point (admin trigger intact)
  // ============================================================

  function DotSurface() {
    var dot = document.querySelector(".brand span");
    if (!dot) return;
    var tip = document.createElement("div");
    tip.className = "dotsurface" + (reduced ? " no-anim" : "");
    tip.setAttribute("role", "menu");
    tip.setAttribute("aria-label", "Quick navigation");
    tip.hidden = true;
    tip.innerHTML =
      SECTIONS.slice(0, 3).map(function (s) {
        return '<a href="#' + s.id + '" role="menuitem" data-section="' + s.id + '">' + s.label + "</a>";
      }).join("") +
      '<a href="#contact" role="menuitem" data-section="contact">Contact</a>' +
      '<span class="dotsurface-kbd"><kbd>⌘K</kbd> search</span>';
    document.body.appendChild(tip);

    var hideTimer = 0;
    function show() {
      clearTimeout(hideTimer);
      tip.hidden = false;
      // position under the dot
      var r = dot.getBoundingClientRect();
      tip.style.left = Math.min(r.left, window.innerWidth - 190) + "px";
      tip.style.top = r.bottom + 10 + "px";
    }
    function hide() { hideTimer = setTimeout(function () { tip.hidden = true; }, 180); }

    dot.parentElement.classList.add("brand-dotsurface");
    dot.parentElement.addEventListener("pointerenter", show);
    dot.parentElement.addEventListener("pointerleave", hide);
    tip.addEventListener("pointerenter", function () { clearTimeout(hideTimer); });
    tip.addEventListener("pointerleave", hide);

    tip.querySelectorAll("[data-section]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        tip.hidden = true;
        Observer.jump(a.getAttribute("data-section"));
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") tip.hidden = true;
    });
    // note: the 5-clicks-on-the-dot admin trigger in main.js is untouched —
    // this surface is hover-only and never intercepts the click.
  }

  // ============================================================
  // ATMOSPHERE — section state modulates the orb field subtly
  // ============================================================

  function Atmosphere() {
    var canvas = document.getElementById("hero-orbs");
    if (!canvas) return;
    // orb-field.js reads two signals each frame: data-section-mod (drift
    // speed, ±15% around 1) and data-section-shift (a per-section seed the
    // field reorganizes around, eased in orb-field.js). Perceptible on a
    // stare, invisible in a glance. Atmosphere reacts to navigation; it
    // never drives it.
    document.addEventListener("nav:section", function (e) {
      var i = SECTIONS.findIndex(function (s) { return s.id === e.detail.id; });
      if (i === -1) i = 0;
      canvas.dataset.sectionMod = String(0.85 + (i % 5) * 0.075);
      canvas.dataset.sectionShift = String(i);
    });
    canvas.dataset.sectionMod = "0.85";
    canvas.dataset.sectionShift = "0";
  }

  // ============================================================
  // BOOT
  // ============================================================

  var Observer = null;

  function boot() {
    // only the homepage has the full section set
    var isHome = !!document.getElementById("about");
    Observer = SectionObserver(function () {});

    if (isHome) {
      DesktopRail(Observer);
      MobileBar(Observer);
      DotSurface();
      Atmosphere();
    }

    // case study pages: contextual navigation is already the .cs-rail;
    // give it the palette + keep behavior consistent
    if (!isHome && document.querySelector(".cs-rail")) {
      var kbd = document.createElement("button");
      kbd.type = "button";
      kbd.className = "navrail-kbd cs-palette-chip";
      kbd.setAttribute("aria-label", "Open command palette (Ctrl K)");
      kbd.innerHTML = '<span class="navrail-kbd-key">⌘K</span>';
      kbd.addEventListener("click", function () { Palette.open(); });
      document.body.appendChild(kbd);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
