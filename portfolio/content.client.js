// Public content hydration — loads centrally saved content over the bundled
// defaults. Defensive by design: any failure means "keep the bundled
// content". Never uses innerHTML; updates textContent and safe attributes only.
(function () {
  "use strict";

  var TEXT_IDS = {
    "f-hero-eyebrow": ["hero", "eyebrow"],
    "f-hero-name": ["hero", "name"],
    "f-hero-headline": ["hero", "headline"],
    "f-hero-sub": ["hero", "sub"],
    "f-about-heading": ["about", "heading"],
    "f-edu-label": ["education", "label"],
    "f-skills-heading": ["skills", "heading"],
    "f-skills-note": ["skills", "note"],
    "f-contact-heading": ["contact", "heading"],
    "f-contact-lede": ["contact", "lede"],
  };

  function setText(id, v) {
    var el = document.getElementById(id);
    if (el && typeof v === "string" && v) el.textContent = v;
  }

  function setHref(id, v) {
    if (typeof v !== "string") return;
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(v) && v.charAt(0) !== "#") return;
    var el = document.getElementById(id);
    if (el && v) {
      el.setAttribute("href", v);
      if (/^https?:/i.test(v)) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener");
      }
    }
  }

  function applyAbout(c) {
    var wrap = document.getElementById("f-about-paragraphs");
    if (!wrap || !Array.isArray(c.about.paragraphs) || !c.about.paragraphs.length) return;
    // wrap children are static <p class="about-text-p"> slots created server-
    // side; we fill the same number of paragraphs that exist.
    var slots = wrap.querySelectorAll(".about-text-p");
    var n = Math.min(slots.length, c.about.paragraphs.length);
    for (var i = 0; i < n; i++) slots[i].textContent = c.about.paragraphs[i];
    // hide extra static slots beyond saved count
    for (var j = n; j < slots.length; j++) slots[j].style.display = "none";
  }

  function applyEducation(c) {
    var wrap = document.getElementById("f-edu-lines");
    if (!wrap || !Array.isArray(c.education.lines)) return;
    var slots = wrap.querySelectorAll(".edu-line");
    var n = Math.min(slots.length, c.education.lines.length);
    for (var i = 0; i < n; i++) slots[i].textContent = c.education.lines[i];
    for (var j = n; j < slots.length; j++) slots[j].style.display = "none";
  }

  function applyProjects(c) {
    var host = document.getElementById("f-projects");
    if (!host) return;
    var template = document.getElementById("f-project-template");
    if (!template) return;

    var saved = (c.projects || []).filter(function (p) {
      return p.visible !== false && typeof p.name === "string" && p.name;
    });
    if (!saved.length) return;

    // remove all statically-defined case articles; rebuild from saved content
    host.querySelectorAll(".case").forEach(function (el) {
      el.remove();
    });

    saved.forEach(function (p, i) {
      var node = template.content.cloneNode(true);
      var root = node.querySelector(".case");
      if (p.flagship) root.classList.add("case-flagship");
      node.querySelector(".case-index").textContent =
        p.index || String(i + 1).padStart(2, "0");
      node.querySelector(".case-name").textContent = p.name;

      var badgeEl = node.querySelector(".case-badge-slot");
      if (p.badge) {
        badgeEl.textContent = p.badge;
      } else {
        badgeEl.remove();
      }

      var rows = node.querySelectorAll(".case-row");
      var map = ["whatItIs", "whyItExists", "howItWorks"];
      rows.forEach(function (row, k) {
        var txt = p[map[k]] || "";
        if (!txt) {
          row.style.display = "none";
        } else {
          row.querySelector("p").textContent = txt;
        }
      });

      var tech = node.querySelector(".tags");
      (p.tech || []).forEach(function (t) {
        var li = document.createElement("li");
        li.textContent = t;
        tech.appendChild(li);
      });
      if (!tech.children.length) tech.style.display = "none";

      var links = node.querySelector(".case-links");
      (p.links || []).forEach(function (l) {
        var a = document.createElement("a");
        a.className = "arrow-link ext";
        a.textContent = l.label;
        a.setAttribute("href", l.url);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
        links.appendChild(a);
      });
      if (!links.children.length) links.style.display = "none";

      var demo = node.querySelector(".case-demo");
      if (p.demoNote) {
        demo.textContent = "";
        var strong = document.createElement("strong");
        strong.textContent = "Try it: ";
        demo.appendChild(strong);
        demo.appendChild(document.createTextNode(p.demoNote));
      } else {
        demo.style.display = "none";
      }

      var svg = node.querySelector(".case-visual-svg use");
      if (svg && p.visual) {
        svg.setAttribute("href", "#pv-" + p.visual);
      }
      var cap = node.querySelector(".case-visual-caption");
      if (p.visualCaption) {
        cap.textContent = p.visualCaption;
      } else {
        cap.style.display = "none";
      }

      host.appendChild(node);
    });
  }

  function applySkills(c) {
    var host = document.getElementById("f-skill-groups");
    if (!host) return;
    var template = document.getElementById("f-skillgroup-template");
    if (!template) return;
    var groups = (c.skills.groups || []).filter(function (g) {
      return g.label && (g.items || []).length;
    });
    if (!groups.length) return;
    host.querySelectorAll(".skill-group").forEach(function (el) {
      el.remove();
    });
    groups.forEach(function (g) {
      var node = template.content.cloneNode(true);
      node.querySelector(".skill-group h3").textContent = g.label;
      var ul = node.querySelector(".skill-group ul");
      g.items.forEach(function (s) {
        var li = document.createElement("li");
        li.textContent = s;
        ul.appendChild(li);
      });
      host.appendChild(node);
    });
  }

  function applyAchievements(c) {
    var host = document.getElementById("f-achievements");
    if (!host) return;
    var template = document.getElementById("f-achievement-template");
    if (!template) return;
    var saved = (c.achievements || []).filter(function (a) {
      return a.visible !== false && a.title;
    });
    if (!saved.length) return;
    host.querySelectorAll(".achievement").forEach(function (el) {
      el.remove();
    });
    saved.forEach(function (a) {
      var node = template.content.cloneNode(true);
      node.querySelector(".ach-year").textContent = a.year || "";
      node.querySelector(".ach-body h3").textContent = a.title;
      node.querySelector(".ach-body p").textContent = a.description || "";
      var link = node.querySelector(".ach-link");
      if (a.linkUrl && a.linkLabel) {
        link.textContent = a.linkLabel;
        link.setAttribute("href", a.linkUrl);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener");
      } else {
        link.remove();
      }
      host.appendChild(node);
    });
  }

  function applyContact(c) {
    var btn = document.querySelector(".email-copy");
    if (btn && c.contact.email) {
      btn.dataset.email = c.contact.email;
      var t = btn.querySelector(".email-text");
      if (t) t.textContent = c.contact.email;
      var m = document.getElementById("f-mailto");
      if (m) m.setAttribute("href", "mailto:" + c.contact.email);
    }
    var host = document.getElementById("f-contact-links");
    if (!host) return;
    var template = document.getElementById("f-contactlink-template");
    if (!template) return;
    var links = (c.contact.links || []).filter(function (l) {
      return l.label && l.url;
    });
    if (!links.length) return;
    host.querySelectorAll(".arrow-link").forEach(function (el) {
      el.remove();
    });
    links.forEach(function (l) {
      var node = template.content.cloneNode(true);
      var a = node.querySelector(".arrow-link");
      a.textContent = l.label;
      a.setAttribute("href", l.url);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
      host.appendChild(a);
    });
  }

  function applySeo(c) {
    if (c.seo.title) document.title = c.seo.title;
    if (c.seo.description) {
      var m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute("content", c.seo.description);
    }
    if (c.seo.socialTitle) {
      var og = document.querySelector('meta[property="og:title"]');
      var tw = document.querySelector('meta[name="twitter:title"]');
      if (og) og.setAttribute("content", c.seo.socialTitle);
      if (tw) tw.setAttribute("content", c.seo.socialTitle);
    }
    if (c.seo.socialDescription) {
      var ogd = document.querySelector('meta[property="og:description"]');
      var twd = document.querySelector('meta[name="twitter:description"]');
      if (ogd) ogd.setAttribute("content", c.seo.socialDescription);
      if (twd) twd.setAttribute("content", c.seo.socialDescription);
    }
  }

  function apply(c) {
    try {
      Object.keys(TEXT_IDS).forEach(function (id) {
        var path = TEXT_IDS[id];
        setText(id, c[path[0]] && c[path[0]][path[1]]);
      });
      if (c.hero) {
        setHref("f-cta-primary", c.hero.ctaPrimary && c.hero.ctaPrimary.href);
        setHref("f-cta-secondary", c.hero.ctaSecondary && c.hero.ctaSecondary.href);
      }
      applyAbout(c);
      applyEducation(c);
      applyProjects(c);
      applySkills(c);
      applyAchievements(c);
      applyContact(c);
      applySeo(c);
    } catch (e) {
      // never break the public page over hydration
    }
  }

  function fetchTimeout(ms) {
    var ctrl = new AbortController();
    setTimeout(function () {
      ctrl.abort();
    }, ms);
    return ctrl.signal;
  }

  window
    .fetch("/api/content", { signal: fetchTimeout(6000) })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (data && data.ok && data.content) apply(data.content);
    })
    .catch(function () {
      /* bundled defaults remain */
    });
})();
