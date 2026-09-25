// 404 — "Rebuild the route home."
// A hand-rolled arrow puzzle: rotate tiles to steer the orb from the broken
// page (start) to home (goal). The orb walks deterministically — each tile
// points where it goes. Boards are carved with a guaranteed solution, then
// scrambled, so a route home always exists (decoys may even open a second
// one — there is always another way home).
//
// Vanilla JS, no engine, no dependencies. Same restraint as the rest of the
// site. Respects prefers-reduced-motion (travel resolves instantly).
(function () {
  "use strict";

  var COLS = 8;
  var ROWS = 6;
  // N, E, S, W — as (dc, dr) deltas
  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  var ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 12h14M13 6l6 6-6 6"/></svg>';
  var START_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>' +
    '<path d="M9.8 13.2l4.4 4.4M14.2 13.2l-4.4 4.4"/></svg>';
  var GOAL_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 11l8-7 8 7"/><path d="M6.5 9.8V20h11V9.8"/></svg>';

  var boardEl = document.getElementById("board");
  var orbEl = document.getElementById("orb");
  var wrapEl = boardEl ? boardEl.parentElement : null;
  var movesEl = document.getElementById("moves");
  var bestEl = document.getElementById("best");
  var statusEl = document.getElementById("status");
  var travelBtn = document.getElementById("travel");
  var scrambleBtn = document.getElementById("scramble");
  var hintBtn = document.getElementById("hint");

  if (!boardEl || !orbEl || !wrapEl || !travelBtn) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var grid = []; // grid[r][c] = { kind, dir, sol, fixed }
  var startCell = null;
  var goalCell = null;
  var moves = 0;
  var busy = false;
  var won = false;

  // ---------- utils ----------

  function rand(n) { return Math.floor(Math.random() * n); }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = rand(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function dirName(d) { return ["north", "east", "south", "west"][d]; }

  function setStatus(msg, isWin) {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.classList.toggle("win", !!isWin);
    }
  }

  function loadBest() {
    try { return Number(localStorage.getItem("pf404-best")) || null; }
    catch (e) { return null; }
  }

  function saveBest(n) {
    try { localStorage.setItem("pf404-best", String(n)); } catch (e) { /* private mode */ }
  }

  function showBest() {
    var b = loadBest();
    if (bestEl) bestEl.textContent = b ? b + " moves" : "—";
  }

  // ---------- board carving ----------

  // Self-avoiding walk from start to goal (random DFS). Returns the path or
  // null — retried until a path of decent length exists.
  function carvePath(from, to) {
    var visited = {};
    var path = [];

    function key(c, r) { return r * COLS + c; }

    function dfs(c, r) {
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
      var k = key(c, r);
      if (visited[k]) return false;
      visited[k] = true;
      path.push({ c: c, r: r });
      if (c === to.c && r === to.r) return true;
      var order = shuffle([0, 1, 2, 3]);
      for (var i = 0; i < 4; i++) {
        if (dfs(c + DIRS[order[i]][0], r + DIRS[order[i]][1])) return true;
      }
      path.pop();
      visited[k] = false;
      return false;
    }

    return dfs(from.c, from.r) ? path : null;
  }

  function dirBetween(a, b) {
    if (b.c === a.c && b.r === a.r - 1) return 0; // N
    if (b.c === a.c + 1 && b.r === a.r) return 1; // E
    if (b.c === a.c && b.r === a.r + 1) return 2; // S
    if (b.c === a.c - 1 && b.r === a.r) return 3; // W
    return -1;
  }

  function newBoard() {
    var path = null;
    for (var attempt = 0; attempt < 80 && (!path || path.length < 8); attempt++) {
      startCell = { c: 0, r: rand(ROWS) };
      goalCell = { c: COLS - 1, r: rand(ROWS) };
      path = carvePath(startCell, goalCell);
    }
    if (!path) { // practically unreachable on 8×6; fall back to straight row
      startCell = { c: 0, r: 2 };
      goalCell = { c: COLS - 1, r: 2 };
      path = [];
      for (var c = 0; c < COLS; c++) path.push({ c: c, r: 2 });
    }

    grid = [];
    for (var r = 0; r < ROWS; r++) {
      grid.push([]);
      for (var cc = 0; cc < COLS; cc++) {
        grid[r].push({
          kind: "arrow",      // arrow | start | goal
          dir: rand(4),       // current direction
          sol: -1,            // carved solution direction (-1 = decoy)
          fixed: false,
        });
      }
    }

    // lay the solution along the carved path
    for (var i = 0; i < path.length - 1; i++) {
      var cell = grid[path[i].r][path[i].c];
      var d = dirBetween(path[i], path[i + 1]);
      cell.sol = d;
      cell.dir = d;
      if (i === 0) { cell.kind = "start"; cell.fixed = true; }
    }
    var g = grid[goalCell.r][goalCell.c];
    g.kind = "goal";
    g.fixed = true;
    g.dir = -1;
    g.sol = -1;

    // scramble: every path arrow starts wrong (1–3 turns off), decoys random
    for (var rr = 0; rr < ROWS; rr++) {
      for (var ccc = 0; ccc < COLS; ccc++) {
        var t = grid[rr][ccc];
        if (t.fixed) continue;
        if (t.sol >= 0) t.dir = (t.sol + 1 + rand(3)) % 4;
        else t.dir = rand(4);
      }
    }
  }

  // ---------- rendering ----------

  function rotationDeg(dir) { return (dir - 1) * 90; } // SVG base points east

  function tileAria(cell, r, c) {
    if (cell.kind === "start") return "The broken page (start) — fixed";
    if (cell.kind === "goal") return "Home — reach this tile";
    return "Row " + (r + 1) + ", column " + (c + 1) +
      " — arrow pointing " + dirName(cell.dir) + ". Activate to rotate clockwise.";
  }

  function render() {
    boardEl.innerHTML = "";
    boardEl.classList.remove("won");
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cell = grid[r][c];
        var el = document.createElement("button");
        el.type = "button";
        el.className = "tile";
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        if (cell.kind === "start") { el.classList.add("fixed", "tile-start"); el.disabled = true; el.innerHTML = START_SVG; }
        else if (cell.kind === "goal") { el.classList.add("fixed", "tile-goal"); el.disabled = true; el.innerHTML = GOAL_SVG; }
        else {
          el.innerHTML = ARROW_SVG;
          el.firstElementChild.style.transform = "rotate(" + rotationDeg(cell.dir) + "deg)";
        }
        el.setAttribute("aria-label", tileAria(cell, r, c));
        boardEl.appendChild(el);
      }
    }
  }

  function tileAt(r, c) {
    return boardEl.children[r * COLS + c];
  }

  function refreshTile(r, c) {
    var cell = grid[r][c];
    var el = tileAt(r, c);
    el.firstElementChild.style.transform = "rotate(" + rotationDeg(cell.dir) + "deg)";
    el.setAttribute("aria-label", tileAria(cell, r, c));
  }

  // ---------- geometry (orb + trail) ----------

  function centerOf(r, c) {
    var wrapRect = wrapEl.getBoundingClientRect();
    var rect = tileAt(r, c).getBoundingClientRect();
    return {
      x: rect.left - wrapRect.left + rect.width / 2,
      y: rect.top - wrapRect.top + rect.height / 2,
    };
  }

  function clearTrail() {
    wrapEl.querySelectorAll(".trail-seg").forEach(function (el) { el.remove(); });
  }

  function layTrail(a, b) {
    var seg = document.createElement("div");
    seg.className = "trail-seg";
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    seg.style.left = a.x + "px";
    seg.style.top = a.y + "px";
    seg.style.width = len + "px";
    seg.style.transform = "rotate(" + Math.atan2(dy, dx) + "rad)";
    wrapEl.appendChild(seg);
  }

  // ---------- the walk ----------

  // Follow arrows from start. Returns { ok, steps, failAt, exitDir, loopAt }.
  function walk() {
    var steps = [];
    var seen = {};
    var c = startCell.c, r = startCell.r;
    var guard = COLS * ROWS + 4;

    while (guard--) {
      var cell = grid[r][c];
      steps.push({ c: c, r: r });
      if (cell.kind === "goal") return { ok: true, steps: steps };
      var k = r * COLS + c;
      if (seen[k]) return { ok: false, reason: "loop", steps: steps, loopAt: { c: c, r: r } };
      seen[k] = true;
      var d = cell.dir;
      var nc = c + DIRS[d][0];
      var nr = r + DIRS[d][1];
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) {
        return { ok: false, reason: "edge", steps: steps, exitDir: d, failAt: { c: c, r: r } };
      }
      c = nc; r = nr;
    }
    return { ok: false, reason: "loop", steps: steps };
  }

  // ---------- travel animation ----------

  function animateRun(result, done) {
    var steps = result.steps;
    if (reduced || steps.length < 2) { done(); return; }

    var pts = steps.map(function (s) { return centerOf(s.r, s.c); });

    if (!result.ok && result.reason === "edge") {
      var ex = DIRS[result.exitDir];
      var lastPt = pts[pts.length - 1];
      pts.push({ x: lastPt.x + ex[0] * 90, y: lastPt.y + ex[1] * 90 });
    }

    for (var i = 1; i < pts.length; i++) layTrail(pts[i - 1], pts[i]);

    var perStep = 230;
    var duration = Math.min(2600, perStep * (pts.length - 1));
    var frames = pts.map(function (p, idx) {
      return {
        transform: "translate(" + p.x + "px, " + p.y + "px) translate(-50%, -50%)",
        offset: idx / (pts.length - 1),
      };
    });
    if (!result.ok) frames.push({ opacity: 0, offset: 1 });

    orbEl.classList.add("live");
    var anim = orbEl.animate(frames, { duration: duration, easing: "cubic-bezier(.4,.1,.3,1)" });
    anim.onfinish = function () {
      orbEl.classList.remove("live");
      done();
    };
    // safety: never let a dropped onfinish hang the controls
    setTimeout(function () {
      if (busy) { orbEl.classList.remove("live"); done(); }
    }, duration + 400);
  }

  function travel() {
    if (busy || won) return;
    busy = true;
    travelBtn.disabled = true;
    clearTrail();
    setStatus("Travelling…", false);

    var result = walk();
    animateRun(result, function () {
      busy = false;
      travelBtn.disabled = false;
      if (result.ok) {
        win(result);
      } else if (result.reason === "edge") {
        setStatus("You sailed off the edge of the internet. Rotate and try again.", false);
      } else {
        setStatus("A loop, not a route — you've been here before.", false);
      }
    });
  }

  function win(result) {
    won = true;
    boardEl.classList.add("won");
    result.steps.forEach(function (s) {
      var el = tileAt(s.r, s.c);
      if (el) el.classList.add("winning");
    });
    var msg = "You were never really lost. Home in " + moves + " moves.";
    var best = loadBest();
    if (!best || moves < best) {
      saveBest(moves);
      showBest();
      msg += " New best!";
    }
    setStatus(msg, true);
  }

  // ---------- interaction ----------

  function rotate(r, c) {
    if (busy || won) return;
    var cell = grid[r][c];
    if (cell.fixed) return;
    cell.dir = (cell.dir + 1) % 4;
    moves++;
    if (movesEl) movesEl.textContent = String(moves);
    refreshTile(r, c);
    setStatus("Rotate arrows to aim the route.", false);
  }

  boardEl.addEventListener("click", function (e) {
    var el = e.target.closest(".tile");
    if (!el || el.disabled) return;
    rotate(Number(el.dataset.r), Number(el.dataset.c));
  });

  travelBtn.addEventListener("click", travel);

  function scramble() {
    if (busy) return;
    won = false;
    moves = 0;
    if (movesEl) movesEl.textContent = "0";
    clearTrail();
    orbEl.classList.remove("live");
    newBoard();
    render();
    setStatus("Rotate arrows to aim the route.", false);
  }

  scrambleBtn.addEventListener("click", scramble);

  // Hint: pulse the first wrong arrow on the route from start (the first tile
  // whose direction differs from the carved solution).
  function hint() {
    if (busy || won) return;
    var result = walk();
    if (result.ok) {
      setStatus("This route already works — press Travel.", false);
      return;
    }
    for (var i = 0; i < result.steps.length; i++) {
      var s = result.steps[i];
      var cell = grid[s.r][s.c];
      if (cell.kind === "arrow" && cell.sol >= 0 && cell.dir !== cell.sol) {
        var el = tileAt(s.r, s.c);
        el.classList.remove("hinting");
        void el.offsetWidth; // restart the pulse animation
        el.classList.add("hinting");
        setTimeout(function () { el.classList.remove("hinting"); }, 1600);
        setStatus("That one's pointing the wrong way.", false);
        return;
      }
    }
    setStatus("Close — one of the decoys is tempting you. Follow the lights.", false);
  }

  hintBtn.addEventListener("click", hint);
  document.addEventListener("keydown", function (e) {
    if (e.key === "h" || e.key === "H") hint();
  });

  // ---------- boot ----------

  showBest();
  scramble();

  // Hidden dev/easter-egg hook: /404#warp lays the carved solution. QA uses
  // it to verify the win path; players who find it just skip their own game.
  if (location.hash === "#warp") {
    for (var wr = 0; wr < ROWS; wr++) {
      for (var wc = 0; wc < COLS; wc++) {
        var wt = grid[wr][wc];
        if (!wt.fixed && wt.sol >= 0) { wt.dir = wt.sol; refreshTile(wr, wc); }
      }
    }
    window.__pf404 = { walk: walk, grid: grid, startCell: startCell, goalCell: goalCell };
  }
})();
