// Editor logic — plain JS, no dependencies.
// Flow: session probe → editor or login. Loads /api/content (falls back to
// bundled defaults), binds inputs, saves via authenticated PUT.
(function () {
  "use strict";

  var state = null; // the working content object
  var dirty = false;

  var el = function (id) {
    return document.getElementById(id);
  };
  var loginView = el("login-view");
  var editorView = el("editor-view");
  var loginMsg = el("login-msg");
  var statusEls = [el("status"), el("status2")];

  function setStatus(msg, kind) {
    statusEls.forEach(function (s) {
      if (!s) return;
      s.textContent = msg;
      s.className = "status" + (kind ? " " + kind : "");
    });
  }

  function setDirty(v) {
    dirty = v;
    setStatus(v ? "Unsaved changes" : "", v ? "err" : "");
  }

  // ---------- API ----------
  function api(method, body) {
    return fetch(method === "DELETE" ? "/api/auth" : method === "PUT" ? "/api/content" : "/api/auth", {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().then(function (data) {
        return { status: r.status, data: data };
      });
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
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok && data.content) return data.content;
        return loadDefaults();
      })
      .catch(loadDefaults);
  }

  // ---------- view switching ----------
  function showLogin() {
    loginView.hidden = false;
    editorView.hidden = true;
    el("logout").hidden = true;
    el("who").hidden = true;
  }

  function showEditor() {
    loginView.hidden = true;
    editorView.hidden = false;
    el("logout").hidden = false;
    el("who").hidden = false;
  }

  // ---------- binding ----------
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

  // simple inputs bound by data-path
  function bindSimple() {
    editorView.querySelectorAll("[data-path]").forEach(function (input) {
      var path = input.getAttribute("data-path");
      var v = getIn(state, path);
      // education lines and about paragraphs are arrays — mapped to l0/l1/p0..
      var m;
      if ((m = path.match(/^education\.l(\d+)$/))) {
        v = (state.education.lines || [])[+m[1]] || "";
      } else if ((m = path.match(/^about\.p(\d+)$/))) {
        v = (state.about.paragraphs || [])[+m[1]] || "";
      }
      input.value = v == null ? "" : v;

      input.addEventListener("input", function () {
        var mm;
        if ((mm = input.getAttribute("data-path").match(/^education\.l(\d+)$/))) {
          state.education.lines = state.education.lines || [];
          state.education.lines[+mm[1]] = input.value;
        } else if ((mm = input.getAttribute("data-path").match(/^about\.p(\d+)$/))) {
          state.about.paragraphs = state.about.paragraphs || [];
          state.about.paragraphs[+mm[1]] = input.value;
        } else {
          setIn(state, input.getAttribute("data-path"), input.value);
        }
        setDirty(true);
      });
    });
  }

  // repeatable card lists
  // Screenshot fields use dotted data-k ("screenshot.src") — map to item.screenshot
  function shotKey(k) {
    var m = k.match(/^screenshot\.(src|alt|caption)$/);
    return m ? m[1] : null;
  }

  function fillCard(card, item, kind) {
    card.querySelectorAll("[data-k]").forEach(function (input) {
      var k = input.getAttribute("data-k");
      var sk = shotKey(k);
      var v = sk ? (item.screenshot || {})[sk] : item[k];
      if (k === "tech" || k === "items") {
        input.value = (v || []).join(", ");
      } else if (k === "links") {
        input.value = (v || []).map(function (l) {
          return l.label + " | " + l.url;
        }).join("\n");
      } else if (input.type === "checkbox") {
        input.checked = k === "visible" ? item.visible !== false : !!v;
      } else {
        input.value = v == null ? "" : v;
      }
      input.addEventListener("input", function () {
        if (k === "tech" || k === "items") {
          item[k] = input.value.split(",").map(function (s) {
            return s.trim();
          }).filter(Boolean);
        } else if (k === "links") {
          item.links = input.value.split("\n").map(function (line) {
            var parts = line.split("|");
            return {
              label: (parts[0] || "").trim(),
              url: (parts[1] || "").trim(),
            };
          }).filter(function (l) {
            return l.label && l.url;
          });
        } else if (input.type === "checkbox") {
          item[k] = input.checked;
        } else if (sk) {
          item.screenshot = item.screenshot || {};
          item.screenshot[sk] = input.value;
        } else {
          item[k] = input.value;
        }
        if (k === "name" || k === "title") {
          var tEl = card.querySelector(".card-title");
          if (tEl) tEl.textContent = (input.value || item.label || "") + (item.flagship ? "  ·  flagship" : "");
        }
        setDirty(true);
      });
    });
    var titleEl = card.querySelector(".card-title");
    if (titleEl) {
      var title = item.name || item.title || item.label;
      var bits = [];
      if (item.flagship) bits.push("flagship");
      if (item.badge) bits.push(item.badge);
      if (titleEl) titleEl.textContent = bits.length ? title + "  ·  " + bits.join(" · ") : title;
    }
  }

  function renderRepeatable(containerId, tplId, list, kind, onClickAdd) {
    var host = el(containerId);
    host.innerHTML = "";
    list.forEach(function (item) {
      var card = el(tplId).content.cloneNode(true).querySelector(".card");
      fillCard(card, item, kind);
      host.appendChild(card);
    });
    var add = document.createElement("button");
    add.type = "button";
    add.className = "btn ghost";
    add.textContent = "+ Add " + kind;
    add.addEventListener("click", onClickAdd);
    host.appendChild(add);
  }

  function renderLists() {
    renderRepeatable("project-list", "tpl-project", state.projects, "project", function () {
      state.projects.push({
        id: "project-" + Date.now(),
        index: String(state.projects.length + 1).padStart(2, "0"),
        name: "New project",
        badge: "",
        flagship: false,
        visible: true,
        whatItIs: "",
        whyItExists: "",
        howItWorks: "",
        role: "",
        team: "",
        timeline: "",
        problem: "",
        contribution: "",
        design: "",
        tradeoff: "",
        outcome: "",
        screenshot: { src: "", alt: "", caption: "" },
        tech: [],
        links: [],
        demoNote: "",
      });
      setDirty(true);
      renderLists();
    });

    renderRepeatable("skillgroup-list", "tpl-skillgroup", state.skills.groups, "skill group", function () {
      state.skills.groups.push({ label: "New group", items: [] });
      setDirty(true);
      renderLists();
    });

    renderRepeatable("achievement-list", "tpl-achievement", state.achievements, "achievement", function () {
      state.achievements.push({
        id: "achievement-" + Date.now(),
        year: String(new Date().getFullYear()),
        title: "New achievement",
        description: "",
        linkLabel: "",
        linkUrl: "",
        visible: true,
      });
      setDirty(true);
      renderLists();
    });

    renderRepeatable("contactlink-list", "tpl-contactlink", state.contact.links, "contact link", function () {
      state.contact.links.push({ label: "", url: "" });
      setDirty(true);
      renderLists();
    });
  }

  // ---------- actions ----------
  function doLogin(e) {
    e.preventDefault();
    loginMsg.textContent = "";
    var password = el("password").value;
    api("POST", { password: password })
      .then(function (r) {
        if (r.data && r.data.ok) {
          el("password").value = "";
          init();
        } else {
          loginMsg.textContent =
            (r.data && r.data.error) || "Sign-in failed.";
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
      state = null;
      showLogin();
    });
  }

  function doSave() {
    setStatus("Saving…", "");
    api("PUT", { content: state })
      .then(function (r) {
        if (r.status === 401) {
          showLogin();
          return;
        }
        if (r.data && r.data.ok) {
          state = r.data.content;
          bindSimple();
          renderLists();
          setDirty(false);
          setStatus(
            "Saved ✓ — live for all visitors (stored centrally). " +
              (r.data.savedAt ? "At " + new Date(r.data.savedAt).toLocaleTimeString() : ""),
            "ok"
          );
        } else {
          setStatus((r.data && r.data.error) || "Save failed.", "err");
        }
      })
      .catch(function () {
        setStatus("Network error — nothing was saved.", "err");
      });
  }

  function doDiscard() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    loadContent().then(function (c) {
      state = c;
      bindSimple();
      renderLists();
      setDirty(false);
      setStatus("Reset to saved content.", "ok");
    });
  }

  function guardUnsaved(e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  }

  // ---------- boot ----------
  function init() {
    loadContent()
      .then(function (c) {
        state = c;
        bindSimple();
        renderLists();
        setDirty(false);
        showEditor();
        setStatus("Loaded saved content" + ".", "ok");
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
  el("save2").addEventListener("click", doSave);
  el("discard").addEventListener("click", doDiscard);
  el("discard2").addEventListener("click", doDiscard);
  window.addEventListener("beforeunload", guardUnsaved);

  probe();
})();
