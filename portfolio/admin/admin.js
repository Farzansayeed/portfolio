// Content editor — plain JS, no dependencies.
//
// Architecture (redesigned):
//   ROUTER  hash routes (#/overview, #/intro, #/projects, …) toggle pages
//           inside one persistent shell — the working state object lives for
//           the whole session, so switching sections never loses edits, and
//           inputs are bound ONCE at boot and refilled in place.
//   LISTS   repeatable cards (projects/skills/achievements/contact links)
//           with delete (with undo), ↑/↓ reordering, and pointer drag-and-
//           drop — all mutating `state` immediately; the card list is
//           re-rendered from state after each structural change.
//   SAVE    PUT /api/content; the server validates strictly and returns the
//           canonical content, which refills every bound input.
//   GUARDS  beforeunload + per-navigation confirm when dirty; dirty dot in
//           the document title; Ctrl/Cmd+S saves anywhere.
(function () {
  "use strict";

  var state = null;      // the working content object (shared across pages)
  var dirty = false;
  var bound = false;     // [data-path] inputs bound once
  var currentRoute = "overview";

  // routes in sidebar order — used for nav highlighting, undo scoping, stats
  var PAGES = ["overview", "intro", "projects", "skills", "achievements", "contact", "seo"];
  var PAGE_META = {
    overview:     { title: "Overview",       lede: "What's on the site right now — edits apply when you save." },
    intro:        { title: "Intro & about",  lede: "Hero, about paragraphs, education, and the \"currently\" strip." },
    projects:     { title: "Projects",       lede: "Shown on the site in this order — drag the handle or use the arrows." },
    skills:       { title: "Skills",         lede: "Heading, note, and the skill groups rendered as rows." },
    achievements: { title: "Achievements",   lede: "Shown in this order — drag to reorder." },
    contact:      { title: "Contact",        lede: "Heading, email, résumé button, and the footer link row." },
    seo:          { title: "SEO & social",   lede: "What browsers and social cards show." },
  };

  var el = function (id) { return document.getElementById(id); };
  var loginView = el("login-view");
  var editorView = el("editor-view");
  var loginMsg = el("login-msg");
  var statusEl = el("status");
  var toastEl = el("toast");
  var baseTitle = document.title;

  // ---------- tiny DOM helpers ----------

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  var toastTimer = 0;
  function toast(msg, kind) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = "toast"; }, 2600);
  }

  function setDirty(v) {
    dirty = v;
    document.body.classList.toggle("dirty", v);
    document.title = baseTitle + (v ? " — unsaved" : "");
    setStatus(v ? "Unsaved changes" : "All changes saved", v ? "err" : "ok");
  }

  // ---------- API ----------

  function api(method, body) {
    return fetch(
      method === "PUT" ? "/api/content" : "/api/auth",
      {
        method: method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
      }
    ).then(function (r) {
      return r.json().then(function (data) { return { status: r.status, data: data }; });
    });
  }

  function loadDefaults() {
    return fetch("../content.default.json").then(function (r) {
      if (!r.ok) throw new Error("defaults unavailable");
      return r.json();
    });
  }

  function loadContent() {
    return fetch("/api/content", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.content) return data.content;
        return loadDefaults();
      })
      .catch(loadDefaults);
  }

  // ---------- router ----------

  function parseRoute() {
    var m = location.hash.match(/^#\/([a-z]+)/);
    return m && PAGES.indexOf(m[1]) !== -1 ? m[1] : "overview";
  }

  function navigate(route, push) {
    if (PAGES.indexOf(route) === -1) route = "overview";
    currentRoute = route;
    PAGES.forEach(function (p) {
      var page = el("page-" + p);
      if (page) page.hidden = p !== route;
    });
    document.querySelectorAll("#nav a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-page") === route);
    });
    var meta = PAGE_META[route];
    if (meta) {
      var h2 = document.querySelector("#page-" + route + " .page-head h2");
      var lede = document.querySelector("#page-" + route + " .page-head .lede");
      if (h2) h2.textContent = meta.title;
      if (lede) lede.textContent = meta.lede;
    }
    if (push !== false && "#/" + route !== location.hash) {
      location.hash = "#/" + route;
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", function () {
    if (!state) return; // login view: no pages to route
    navigate(parseRoute(), false);
  });

  // ---------- value binding (once) ----------

  function getIn(obj, path) {
    return path.split(".").reduce(function (o, k) {
      return o == null ? undefined : o[k];
    }, obj);
  }

  function setIn(obj, path, value) {
    var keys = path.split(".");
    var cur = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function simpleValue(path) {
    var m;
    if ((m = path.match(/^education\.l(\d+)$/))) return (state.education.lines || [])[+m[1]] || "";
    if ((m = path.match(/^about\.p(\d+)$/))) return (state.about.paragraphs || [])[+m[1]] || "";
    return getIn(state, path);
  }

  function writeSimple(path, value) {
    var m;
    if ((m = path.match(/^education\.l(\d+)$/))) {
      state.education.lines = state.education.lines || [];
      state.education.lines[+m[1]] = value;
    } else if ((m = path.match(/^about\.p(\d+)$/))) {
      state.about.paragraphs = state.about.paragraphs || [];
      state.about.paragraphs[+m[1]] = value;
    } else {
      setIn(state, path, value);
    }
  }

  function refillSimple() {
    editorView.querySelectorAll("[data-path]").forEach(function (input) {
      var v = simpleValue(input.getAttribute("data-path"));
      input.value = v == null ? "" : v;
    });
  }

  function bindSimple() {
    if (bound) return;
    bound = true;
    editorView.querySelectorAll("[data-path]").forEach(function (input) {
      input.addEventListener("input", function () {
        writeSimple(input.getAttribute("data-path"), input.value);
        setDirty(true);
      });
    });
  }

  // ---------- repeatable cards ----------

  // Screenshot fields use dotted data-k ("screenshot.src") — map to item.screenshot
  function shotKey(k) {
    var m = k.match(/^screenshot\.(src|alt|caption)$/);
    return m ? m[1] : null;
  }

  function cardTitle(item) {
    var title = item.name || item.title || item.label || "";
    var bits = [];
    if (item.flagship) bits.push("flagship");
    if (item.badge) bits.push(item.badge);
    if (item.visible === false) bits.push("hidden");
    return title + (bits.length ? "  ·  " + bits.join(" · ") : "");
  }

  function fillCard(card, item) {
    card.querySelectorAll("[data-k]").forEach(function (input) {
      var k = input.getAttribute("data-k");
      var sk = shotKey(k);
      var v = sk ? (item.screenshot || {})[sk] : item[k];
      if (k === "tech" || k === "items") {
        input.value = (v || []).join(", ");
      } else if (k === "links") {
        input.value = (v || []).map(function (l) { return l.label + " | " + l.url; }).join("\n");
      } else if (input.type === "checkbox") {
        input.checked = k === "visible" ? item.visible !== false : !!v;
      } else {
        input.value = v == null ? "" : v;
      }
      input.addEventListener("input", function () {
        if (k === "tech" || k === "items") {
          item[k] = input.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        } else if (k === "links") {
          item.links = input.value.split("\n").map(function (line) {
            var parts = line.split("|");
            return { label: (parts[0] || "").trim(), url: (parts[1] || "").trim() };
          }).filter(function (l) { return l.label && l.url; });
        } else if (input.type === "checkbox") {
          item[k] = input.checked;
        } else if (sk) {
          item.screenshot = item.screenshot || {};
          item.screenshot[sk] = input.value;
        } else {
          item[k] = input.value;
        }
        if (k === "name" || k === "title" || k === "label" || k === "flagship" || k === "badge" || k === "visible") {
          card.querySelector(".card-title").textContent = cardTitle(item);
        }
        setDirty(true);
      });
    });
    var titleEl = card.querySelector(".card-title");
    if (titleEl) titleEl.textContent = cardTitle(item);
  }

  // wire the per-card toolbar (delete/undo/move/drag)
  function wireCard(card, list, item, rerender) {
    var del = card.querySelector(".del");
    if (del) {
      del.addEventListener("click", function () {
        var idx = list.indexOf(item);
        if (idx === -1) return;
        list.splice(idx, 1);
        setDirty(true);
        rerender();
        toast("Deleted — click to undo", "err");
        // one-shot undo affordance in the toast itself
        toastEl.onclick = function () {
          list.splice(Math.min(idx, list.length), 0, item);
          setDirty(true);
          rerender();
          toast("Restored", "ok");
          toastEl.onclick = null;
        };
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(function () { toastEl.onclick = null; }, 2600);
      });
    }
    var up = card.querySelector(".up");
    var down = card.querySelector(".down");
    if (up) up.addEventListener("click", function () { moveItem(list, item, -1, rerender); });
    if (down) down.addEventListener("click", function () { moveItem(list, item, +1, rerender); });

    // pointer drag-and-drop reorder via the ⠿ handle
    var handle = card.querySelector(".drag");
    if (handle) {
      handle.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        var host = card.parentElement;
        var cards = Array.prototype.slice.call(host.querySelectorAll(":scope > .card"));
        var startY = e.clientY;
        card.classList.add("dragging");
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* synthetic/jailed pointers */ }

        function onMove(ev) {
          var dy = ev.clientY - startY;
          card.style.transform = "translateY(" + dy + "px)";
          var target = cardUnderPointer(host, card, ev.clientY);
          host.querySelectorAll(".card.drop-target").forEach(function (c) {
            if (c !== card) c.classList.remove("drop-target");
          });
          if (target) target.classList.add("drop-target");
        }
        function onUp(ev) {
          try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* not captured */ }
          card.removeEventListener("pointermove", onMove);
          card.removeEventListener("pointerup", onUp);
          card.removeEventListener("pointercancel", onUp);
          var target = cardUnderPointer(host, card, ev.clientY);
          card.classList.remove("dragging");
          card.style.transform = "";
          host.querySelectorAll(".card.drop-target").forEach(function (c) { c.classList.remove("drop-target"); });
          if (target && target !== card) {
            var from = list.indexOf(item);
            var targetItem = target.__item;
            var toIdx = list.indexOf(targetItem);
            if (from !== -1 && toIdx !== -1) {
              list.splice(from, 1);
              list.splice(toIdx, 0, item);
              setDirty(true);
              rerender();
            }
          }
        }
        card.addEventListener("pointermove", onMove);
        card.addEventListener("pointerup", onUp);
        card.addEventListener("pointercancel", onUp);
      });
    }
  }

  function cardUnderPointer(host, dragged, y) {
    var found = null;
    host.querySelectorAll(":scope > .card").forEach(function (c) {
      if (c === dragged) return;
      var r = c.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) found = c;
    });
    return found;
  }

  function moveItem(list, item, delta, rerender) {
    var i = list.indexOf(item);
    var j = i + delta;
    if (i === -1 || j < 0 || j >= list.length) return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    setDirty(true);
    rerender();
  }

  function renderRepeatable(containerId, tplId, list, rerenderAll) {
    var host = el(containerId);
    host.innerHTML = "";
    list.forEach(function (item) {
      var card = el(tplId).content.cloneNode(true).querySelector(".card");
      card.__item = item;
      fillCard(card, item);
      wireCard(card, list, item, rerenderAll);
      host.appendChild(card);
    });
  }

  function renderLists() {
    renderRepeatable("project-list", "tpl-project", state.projects, renderLists);
    renderRepeatable("skillgroup-list", "tpl-skillgroup", state.skills.groups, renderLists);
    renderRepeatable("achievement-list", "tpl-achievement", state.achievements, renderLists);
    renderRepeatable("contactlink-list", "tpl-contactlink", state.contact.links, renderLists);
    renderStats();
  }

  // ---------- add buttons (declared in index.html, wired once) ----------

  var addsWired = false;

  function wireAddButtons() {
    if (addsWired) return; // init() can run again after logout/login — bind once
    addsWired = true;
    el("add-project").addEventListener("click", function () {
      state.projects.push({
        id: "project-" + Date.now(),
        index: String(state.projects.length + 1).padStart(2, "0"),
        name: "New project",
        badge: "",
        flagship: false,
        visible: true,
        whatItIs: "", whyItExists: "", howItWorks: "",
        role: "", team: "", timeline: "",
        problem: "", contribution: "", design: "", tradeoff: "", outcome: "",
        screenshot: { src: "", alt: "", caption: "" },
        tech: [], links: [], demoNote: "",
        visual: "evidence", visualCaption: "",
      });
      setDirty(true); renderLists();
      el("project-list").lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    el("add-skillgroup").addEventListener("click", function () {
      state.skills.groups.push({ label: "New group", items: [] });
      setDirty(true); renderLists();
    });
    el("add-achievement").addEventListener("click", function () {
      state.achievements.push({
        id: "achievement-" + Date.now(),
        year: String(new Date().getFullYear()),
        title: "New achievement",
        description: "", linkLabel: "", linkUrl: "", visible: true,
      });
      setDirty(true); renderLists();
    });
    el("add-contactlink").addEventListener("click", function () {
      state.contact.links.push({ label: "", url: "" });
      setDirty(true); renderLists();
    });
  }

  // ---------- overview stats ----------

  function renderStats() {
    var stats = el("stats");
    var quick = el("quick");
    if (!stats || !quick || !state) return;
    var visibleProjects = state.projects.filter(function (p) { return p.visible !== false; });
    var flagship = visibleProjects.filter(function (p) { return p.flagship; }).length;
    var hidden = state.projects.length - visibleProjects.length;
    var cells = [
      [String(state.projects.length), "projects"],
      [String(visibleProjects.length) + (hidden ? " (+" + hidden + " hidden)" : ""), "visible"],
      [String(state.skills.groups.length), "skill groups"],
      [String(state.achievements.length), "achievements"],
    ];
    stats.innerHTML = "";
    cells.forEach(function (c) {
      var d = document.createElement("div");
      d.className = "stat";
      d.innerHTML = "";
      var b = document.createElement("b"); b.textContent = c[0];
      var s = document.createElement("span"); s.textContent = c[1];
      d.appendChild(b); d.appendChild(s);
      stats.appendChild(d);
    });
    quick.innerHTML = "";
    [
      ["#/intro", "Intro & about", "Hero, about, education, currently"],
      ["#/projects", "Projects", visibleProjects.length + " visible · " + flagship + " flagship"],
      ["#/skills", "Skills", state.skills.groups.length + " groups"],
      ["#/contact", "Contact", state.contact.links.length + " links · résumé"],
    ].forEach(function (q) {
      var a = document.createElement("a");
      a.className = "card";
      a.href = q[0];
      var b = document.createElement("b"); b.textContent = q[1];
      var s = document.createElement("span"); s.textContent = q[2];
      a.appendChild(b); a.appendChild(s);
      quick.appendChild(a);
    });
  }

  // ---------- view switching ----------

  function showLogin() {
    loginView.hidden = false;
    editorView.hidden = true;
    state = null;
    setDirty(false);
  }

  function showEditor() {
    loginView.hidden = true;
    editorView.hidden = false;
    navigate(parseRoute(), true);
  }

  // ---------- actions ----------

  function doLogin(e) {
    e.preventDefault();
    loginMsg.textContent = "";
    var password = el("password").value;
    setStatus("Signing in…", "");
    api("POST", { password: password })
      .then(function (r) {
        if (r.data && r.data.ok) {
          el("password").value = "";
          init();
        } else {
          loginMsg.textContent = (r.data && r.data.error) || "Sign-in failed.";
          if (r.status === 429) {
            loginMsg.textContent = "Too many attempts. Wait a few minutes and try again.";
          }
        }
      })
      .catch(function () {
        loginMsg.textContent = "Network error. Try again.";
      });
  }

  function doLogout() {
    api("DELETE").then(function () {
      showLogin();
      toast("Signed out", "");
    });
  }

  function doSave() {
    if (!state || saving) return; // in-flight guard
    saving = true;
    var btn = el("save");
    if (btn) btn.disabled = true;
    setStatus("Saving…", "");
    api("PUT", { content: state })
      .then(function (r) {
        if (r.status === 401) { showLogin(); return; }
        if (r.data && r.data.ok) {
          state = r.data.content;
          refillSimple();
          renderLists();
          setDirty(false);
          setStatus("Saved ✓ — live for all visitors" +
            (r.data.savedAt ? " at " + new Date(r.data.savedAt).toLocaleTimeString() : ""), "ok");
          toast("Saved — live on the site", "ok");
        } else {
          setStatus((r.data && r.data.error) || "Save failed.", "err");
          toast((r.data && r.data.error) || "Save failed", "err");
        }
      })
      .catch(function () {
        setStatus("Network error — nothing was saved.", "err");
        toast("Network error — nothing was saved", "err");
      })
      .then(function () {
        saving = false;
        if (btn) btn.disabled = false;
      });
  }

  var saving = false;

  function doDiscard() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    loadContent().then(function (c) {
      state = c;
      refillSimple();
      renderLists();
      setDirty(false);
      setStatus("Reset to saved content.", "ok");
      toast("Reset to saved content", "ok");
    });
  }

  function guardUnsaved(e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  }

  // confirm before leaving the editor when dirty (hash navigation)
  window.addEventListener("beforeunload", guardUnsaved);

  // Ctrl/Cmd+S saves from anywhere in the editor; Esc leaves a text field
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      if (!state) return;
      e.preventDefault();
      doSave();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) t.blur();
  });

  // ---------- boot ----------

  function init() {
    loadContent()
      .then(function (c) {
        state = c;
        bindSimple();   // once — listeners are never re-added
        refillSimple(); // fill from state on every load/save/discard
        renderLists();
        wireAddButtons();
        setDirty(false);
        showEditor();
        setStatus("Loaded saved content.", "ok");
      })
      .catch(function () {
        setStatus("Could not load content.", "err");
      });
  }

  function probe() {
    // read-only session check — GET /api/auth returns 200 authed, 401 not
    fetch("/api/auth", { credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) showLogin();
        else init();
      })
      .catch(showLogin);
  }

  el("login-form").addEventListener("submit", doLogin);
  el("logout").addEventListener("click", doLogout);
  el("save").addEventListener("click", doSave);
  el("discard").addEventListener("click", doDiscard);

  probe();
})();
