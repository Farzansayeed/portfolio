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
    // Central content wins even when intentionally empty ("" clears the
    // bundled text rather than preserving it).
    if (el && typeof v === "string") el.textContent = v;
  }

  function setHref(id, v) {
    // An empty/absent href means "no override" (the server validator already
    // normalizes blank hrefs to sensible anchors, so "" rarely arrives).
    // Accepts anchors, absolute http(s), and safe site-relative paths
    // (e.g. "resume.pdf") — mirrors the server-side safeHref allow-list.
    if (typeof v !== "string" || !v) return;
    var isSafePath = /^[A-Za-z0-9][A-Za-z0-9/_ .-]*$/.test(v) && v.indexOf("..") < 0 && v.indexOf("\\") < 0;
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(v) && v.charAt(0) !== "#" && !isSafePath) return;
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
    if (!wrap || !Array.isArray(c.about.paragraphs)) return;
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

  function applyCurrently(c) {
    var cur = c.currently;
    if (!cur || typeof cur !== "object") return;
    setText("f-cur-building", cur.building);
    setText("f-cur-learning", cur.learning);
    setText("f-cur-target", cur.targetRole);
  }

  function applyPrivateWork(c) {
    var pw = c.privateWork;
    if (!pw || typeof pw !== "object") return;
    var p = document.querySelector(".private-note");
    var label = typeof pw.label === "string" ? pw.label : null;
    var note = typeof pw.note === "string" ? pw.note : null;
    if (label !== null) setText("f-private-label", label);
    if (note !== null) setText("f-private-note", note);
    // both intentionally empty → the note disappears entirely
    if (p && label !== null && note !== null && !label && !note) {
      p.style.display = "none";
    }
  }

  function applyProjects(c) {
    var host = document.getElementById("f-projects");
    if (!host) return;
    var template = document.getElementById("f-project-template");
    if (!template) return;

    // Central content is authoritative even when it empties the list.
    // Only null/non-array central content (older schema) keeps the bundled markup.
    if (!Array.isArray(c.projects)) return;

    var saved = c.projects.filter(function (p) {
      return p.visible !== false && typeof p.name === "string" && p.name;
    });

    // remove all statically-defined case articles; rebuild from saved content
    host.querySelectorAll(".case").forEach(function (el) {
      el.remove();
    });

    saved.forEach(function (p, i) {
      var node = template.content.cloneNode(true);
      var root = node.querySelector(".case");
      if (p.flagship) root.classList.add("case-flagship");
      if (p.id) root.id = "project-" + p.id;
      node.querySelector(".case-index").textContent =
        p.index || String(i + 1).padStart(2, "0");
      node.querySelector(".case-name").textContent = p.name;

      var badgeEl = node.querySelector(".case-badge-slot");
      if (p.badge) {
        badgeEl.textContent = p.badge;
      } else {
        badgeEl.remove();
      }

      // metadata row: Role / Team / Timeline / Stack (Stack derives from tech)
      var meta = node.querySelector(".case-meta");
      var metaMap = { "m-role": p.role, "m-team": p.team, "m-timeline": p.timeline };
      var metaFilled = 0;
      Object.keys(metaMap).forEach(function (cls) {
        var dd = node.querySelector("." + cls);
        var cell = dd && dd.parentElement;
        if (metaMap[cls]) {
          dd.textContent = metaMap[cls];
          metaFilled++;
        } else if (cell) {
          cell.style.display = "none";
        }
      });
      if (Array.isArray(p.tech) && p.tech.length) {
        node.querySelector(".m-stack").textContent = p.tech.join(" · ");
        metaFilled++;
      } else {
        var stackCell = node.querySelector(".m-stack");
        if (stackCell && stackCell.parentElement) stackCell.parentElement.style.display = "none";
      }
      if (meta && !metaFilled) meta.style.display = "none";

      // case-study rows are driven by data-row attributes on the template
      var rowMap = {
        what: "whatItIs",
        why: "whyItExists",
        how: "howItWorks",
        problem: "problem",
        contribution: "contribution",
        design: "design",
        tradeoff: "tradeoff",
        outcome: "outcome",
      };
      node.querySelectorAll(".case-row").forEach(function (row) {
        var key = row.getAttribute("data-row");
        var txt = key && rowMap[key] ? p[rowMap[key]] || "" : "";
        if (!txt) {
          row.style.display = "none";
        } else {
          row.querySelector("p").textContent = txt;
        }
      });

      // (technologies render in the metadata Stack cell — no separate tag list)

      var links = node.querySelector(".case-links");
      (p.links || []).forEach(function (l) {
        if (!l || !l.url || !l.label) return;
        var isSafePath = /^[A-Za-z0-9][A-Za-z0-9/_ .-]*$/.test(l.url) && l.url.indexOf("..") < 0 && l.url.indexOf("\\") < 0;
        if (!/^https?:\/\/[^\s"'<>]+$/i.test(l.url) && !isSafePath) return;
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

      // screenshot figure — replaces the v1 abstract SVG visuals
      var shot = p.screenshot;
      var fig = node.querySelector(".case-shot");
      if (fig && shot && shot.src) {
        var img = fig.querySelector("img");
        img.setAttribute("src", shot.src);
        img.setAttribute("alt", shot.alt || p.name + " screenshot");
        var capEl = fig.querySelector("figcaption");
        if (shot.caption) {
          capEl.textContent = shot.caption;
        } else {
          capEl.style.display = "none";
        }
        fig.hidden = false;
      }

      host.appendChild(node);
    });
  }

  function applySkills(c) {
    var host = document.getElementById("f-skill-groups");
    if (!host) return;
    var template = document.getElementById("f-skillgroup-template");
    if (!template) return;
    if (!c.skills || typeof c.skills !== "object" || !Array.isArray(c.skills.groups)) return;

    var groups = c.skills.groups.filter(function (g) {
      return g.label && (g.items || []).length;
    });
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
    if (!Array.isArray(c.achievements)) return;

    var saved = c.achievements.filter(function (a) {
      return a.visible !== false && a.title;
    });
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
    // résumé link — hidden entirely when no URL is configured
    var resume = c.contact && c.contact.resume;
    var rLink = document.getElementById("f-resume-link");
    if (rLink) {
      if (resume && resume.url) {
        if (resume.label) rLink.textContent = resume.label;
        rLink.setAttribute("href", resume.url);
        if (!/^https?:/i.test(resume.url)) rLink.setAttribute("download", "");
        rLink.style.display = "";
      } else {
        rLink.style.display = "none";
      }
    }
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
    if (!c.contact || typeof c.contact !== "object" || !Array.isArray(c.contact.links)) return;

    var links = c.contact.links.filter(function (l) {
      return l.label && l.url;
    });
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
      applyCurrently(c);
      applyPrivateWork(c);
      applyProjects(c);
      applySkills(c);
      applyAchievements(c);
      applyContact(c);
      applySeo(c);
    } catch (e) {
      console.error("hydration error:", e && (e.message || String(e)));
    }
  }

  function fetchTimeout(ms) {
    var ctrl = new AbortController();
    setTimeout(function () {
      ctrl.abort();
    }, ms);
    return ctrl.signal;
  }

  // True only when content is degenerate — mirrors the server validator floor
  // (a save must contain a hero name or ≥1 project). Anything the server
  // accepted is legitimate central authority, including emptied collections.
  function isHollowContent(c) {
    if (!c || typeof c !== "object") return true;
    if (typeof c.hero !== "object" || c.hero === null) return true;
    var name = typeof c.hero.name === "string" ? c.hero.name.trim() : "";
    var projectCount = Array.isArray(c.projects) ? c.projects.length : 0;
    return !(name.length > 0 || projectCount > 0);
  }

  window
    .fetch("/api/content", { signal: fetchTimeout(6000) })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      // Central content, once retrieved, is authoritative — including its
      // intentionally empty fields. Only total unavailability (bad status,
      // network error, malformed JSON, hollow all-empty content) falls back.
      if (data && data.ok && data.content && !isHollowContent(data.content)) {
        apply(data.content);
      }
    })
    .catch(function () {
      /* bundled defaults remain */
    });
})();
