// 404 — "Arrow Escape" · long-tail polyline edition
//
// Every arrow is ONE continuous axis-aligned polyline: a long tail with
// 90° bends and a single arrowhead. The FINAL segment's direction is the
// arrow's escape direction (bends in the tail don't change it). Tapping an
// arrow whose corridor to the edge is clear extracts it — a rigid
// translation along the escape direction, arrowhead leading, tail following
// — until the whole line has left the board. Blocked taps cost one of three
// hearts. Clear every arrow to escape the 404.
//
// Architecture:
//   LEVELS  frozen, solver-validated level data (hand-authored tutorials
//           + offline-generated, frozen as literals — nothing random at
//           runtime, so the game is deterministic and fast)
//   LOGIC   pure functions over geometry: cell rasterization, corridor
//           trace, blocking, backtracking solver with state-hashing
//   STATE   gameStatus (READY/PLAYING/ANIMATING/LEVEL_COMPLETE/GAME_OVER),
//           hearts, moves, epoch guard for in-flight animations
//   RENDER  one SVG per level; each arrow = <g> with fat invisible hit
//           path, thin visible line, chevron head
//   UI      404 frame, hearts, status line, overlays, restart/home
//
// Vanilla JS + SVG. No dependencies. Honors prefers-reduced-motion.
(function () {
  "use strict";

  // ============================================================
  // LEVELS — frozen data (generated + solver-validated offline)
  // ============================================================

  var LEVELS = [
    { W: 10, H: 6, arrows: [
      { id: 1, pts: [[5, 2],[8, 2]] },
      { id: 2, pts: [[0, 5],[2, 5],[2, 2],[4, 2]] }
    ] },
    { W: 10, H: 8, arrows: [
      { id: 1, pts: [[1, 7],[1, 4]] },
      { id: 2, pts: [[1, 2],[1, 0]] },
      { id: 3, pts: [[9, 3],[5, 3],[5, 6]] },
      { id: 4, pts: [[8, 6],[8, 4],[8, 1]] }
    ] },
    { W: 11, H: 11, arrows: [
      { id: 1, pts: [[3, 4],[6, 4],[6, 9],[9, 9]] },
      { id: 2, pts: [[4, 1],[4, 3],[10, 3],[10, 6]] },
      { id: 3, pts: [[5, 5],[5, 6],[1, 6],[1, 9]] },
      { id: 4, pts: [[7, 0],[5, 0],[5, 2]] },
      { id: 5, pts: [[3, 1],[1, 1],[1, 5]] },
      { id: 6, pts: [[0, 4],[0, 9]] },
      { id: 7, pts: [[10, 7],[10, 10],[7, 10]] }
    ] },
    { W: 12, H: 13, arrows: [
      { id: 1, pts: [[2, 0],[3, 0],[3, 6],[7, 6]] },
      { id: 2, pts: [[11, 7],[11, 5],[5, 5],[5, 1]] },
      { id: 3, pts: [[3, 7],[9, 7]] },
      { id: 4, pts: [[10, 7],[10, 10],[4, 10]] },
      { id: 5, pts: [[6, 3],[6, 0],[11, 0]] },
      { id: 6, pts: [[2, 8],[8, 8]] },
      { id: 7, pts: [[11, 2],[8, 2],[8, 4]] },
      { id: 8, pts: [[0, 8],[0, 7],[2, 7],[2, 3]] },
      { id: 9, pts: [[3, 9],[9, 9]] }
    ] },
    { W: 13, H: 14, arrows: [
      { id: 1, pts: [[5, 6],[5, 8],[11, 8],[11, 12]] },
      { id: 2, pts: [[7, 0],[9, 0],[9, 5]] },
      { id: 3, pts: [[2, 4],[2, 5],[8, 5]] },
      { id: 4, pts: [[7, 13],[5, 13],[5, 9],[0, 9]] },
      { id: 5, pts: [[3, 4],[3, 1],[8, 1]] },
      { id: 6, pts: [[10, 13],[10, 11],[6, 11]] },
      { id: 7, pts: [[2, 8],[0, 8],[0, 2]] },
      { id: 8, pts: [[11, 2],[10, 2],[10, 6],[6, 6]] },
      { id: 9, pts: [[12, 4],[12, 10]] },
      { id: 10, pts: [[11, 7],[6, 7]] },
      { id: 11, pts: [[1, 0],[1, 4]] }
    ] }
  ];

  var START_HEARTS = 3;
  // after the last level, "next" cycles the three generated boards
  var NEXT_OF = [1, 2, 3, 4, 3];

  // ============================================================
  // LOGIC — pure geometry, no DOM
  // ============================================================

  var DIRV = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

  function dirOf(a) {
    var p = a.pts, n = p.length;
    var x1 = p[n - 2][0], y1 = p[n - 2][1], x2 = p[n - 1][0], y2 = p[n - 1][1];
    if (y2 === y1 && x2 > x1) return "R";
    if (y2 === y1 && x2 < x1) return "L";
    if (x2 === x1 && y2 > y1) return "D";
    if (x2 === x1 && y2 < y1) return "U";
    return "R";
  }

  var cellCache = new Map(); // arrow object -> Set("x,y")  (per level copy)
  function cellsOf(a) {
    var cached = cellCache.get(a);
    if (cached) return cached;
    var set = {};
    for (var i = 0; i < a.pts.length - 1; i++) {
      var x = a.pts[i][0], y = a.pts[i][1];
      var x2 = a.pts[i + 1][0], y2 = a.pts[i + 1][1];
      var dx = Math.sign(x2 - x), dy = Math.sign(y2 - y);
      for (;;) {
        set[x + "," + y] = true;
        if (x === x2 && y === y2) break;
        x += dx; y += dy;
      }
    }
    cellCache.set(a, set);
    return set;
  }

  // Cells strictly beyond the head, in escape direction, to the edge.
  function corridorOf(a, W, H) {
    var d = DIRV[a.dir];
    var x = a.pts[a.pts.length - 1][0] + d[0];
    var y = a.pts[a.pts.length - 1][1] + d[1];
    var cells = [];
    while (x >= 0 && y >= 0 && x < W && y < H) {
      cells.push(x, y);
      x += d[0]; y += d[1];
    }
    return cells;
  }

  function isBlocked(a, live, W, H) {
    var occ = {};
    for (var i = 0; i < live.length; i++) {
      if (live[i] === a || live[i].state === "REMOVED") continue;
      var cs = cellsOf(live[i]);
      for (var k in cs) occ[k] = true;
    }
    var cor = corridorOf(a, W, H);
    for (var j = 0; j < cor.length; j += 2) {
      if (occ[cor[j] + "," + cor[j + 1]]) return true;
    }
    return false;
  }

  // Distance (user units) to translate until the whole arrow is off-board.
  function exitDistance(a, W, H) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < a.pts.length; i++) {
      var x = a.pts[i][0], y = a.pts[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    switch (a.dir) {
      case "R": return W - minX;
      case "L": return maxX + 1;
      case "D": return H - minY;
      case "U": return maxY + 1;
    }
    return W;
  }

  // Backtracking solver with state-hashing — validates every level at load.
  function solveLevel(W, H, arrows) {
    var remaining = {}, count = 0;
    for (var i = 0; i < arrows.length; i++) { remaining[arrows[i].id] = true; count++; }
    var visited = {};

    function rec() {
      if (count === 0) return true;
      var ids = Object.keys(remaining).map(Number).sort(function (a, b) { return a - b; });
      var k = ids.join("|");
      if (visited[k]) return false;
      visited[k] = true;

      var live = [];
      for (var j = 0; j < arrows.length; j++) {
        if (remaining[arrows[j].id]) live.push(arrows[j]);
      }
      var anyFree = false;
      for (var m = 0; m < live.length; m++) {
        if (!isBlocked(live[m], live, W, H)) {
          anyFree = true;
          delete remaining[live[m].id];
          count--;
          if (rec()) { count++; remaining[live[m].id] = true; return true; }
          count++;
          remaining[live[m].id] = true;
        }
      }
      return anyFree ? false : false;
    }
    return rec();
  }

  // ============================================================
  // STATE + DOM
  // ============================================================

  var svg = document.getElementById("board");
  var statusEl = document.getElementById("status");
  var heartsEl = document.getElementById("hearts");
  var movesEl = document.getElementById("moves");
  var levelEl = document.getElementById("level");
  var restartBtn = document.getElementById("restart");
  var overlayEl = document.getElementById("overlay");
  var kickerEl = document.getElementById("overlay-kicker");
  var titleEl = document.getElementById("overlay-title");
  var subEl = document.getElementById("overlay-sub");
  var primaryBtn = document.getElementById("overlay-primary");
  var homeLink = document.getElementById("overlay-home");

  if (!svg) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var game = {
    status: "READY",        // READY | PLAYING | ANIMATING | LEVEL_COMPLETE | GAME_OVER
    levelIndex: 0,
    hearts: START_HEARTS,
    moves: 0,
    arrows: [],
    epoch: 0,
  };

  var DIR_ANGLE = { R: 0, D: 90, L: 180, U: 270 };
  var DIR_WORD = { U: "up", D: "down", L: "left", R: "right" };

  // ============================================================
  // RENDER
  // ============================================================

  var SVGNS = "http://www.w3.org/2000/svg";

  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function pathD(pts) {
    var d = "M " + pts[0][0] + " " + pts[0][1];
    for (var i = 1; i < pts.length; i++) d += " L " + pts[i][0] + " " + pts[i][1];
    return d;
  }

  function describe(a, idx) {
    var head = a.pts[a.pts.length - 1];
    var blocked = isBlocked(a, game.arrows, game.W, game.H);
    return "Arrow " + (idx + 1) + ", head at column " + (head[0] + 1) + ", row " +
      (head[1] + 1) + ", escaping " + DIR_WORD[a.dir] + ". " +
      (blocked ? "Path blocked." : "Path clear. Activate to escape.");
  }

  function buildBoard() {
    var L = LEVELS[game.levelIndex];
    game.W = L.W;
    game.H = L.H;
    cellCache.clear();
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "-0.6 -0.6 " + (L.W + 1.2) + " " + (L.H + 1.2));

    game.arrows = L.arrows.map(function (src) {
      return {
        id: src.id,
        pts: src.pts.map(function (p) { return [p[0], p[1]]; }),
        dir: dirOf(src),
        state: "IDLE",
        el: null,
      };
    });

    // solver gate: a level that cannot ship must never render
    if (!solveLevel(L.W, L.H, game.arrows)) {
      console.error("level", game.levelIndex + 1, "failed solver; aborting render");
      return;
    }

    var sorted = game.arrows.slice().sort(function (a, b) {
      var la = cellsOf(a), lb = cellsOf(b);
      return Object.keys(lb).length - Object.keys(la).length; // long tails first
    });

    sorted.forEach(function (a) {
      var g = el("g", { class: "arrow", "data-id": a.id, tabindex: "0", role: "button" });

      var hit = el("path", {
        d: pathD(a.pts),
        class: "hit",
        fill: "none",
        "stroke-width": "0.85",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      var line = el("path", {
        d: pathD(a.pts),
        class: "line",
        fill: "none",
        "stroke-width": "0.085",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      var h = a.pts[a.pts.length - 1];
      var head = el("path", {
        d: "M -0.3 -0.3 L 0 0 L -0.3 0.3",
        class: "head",
        fill: "none",
        "stroke-width": "0.085",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        transform: "translate(" + h[0] + " " + h[1] + ") rotate(" + DIR_ANGLE[a.dir] + ")",
      });

      g.appendChild(hit);
      g.appendChild(line);
      g.appendChild(head);
      svg.appendChild(g);
      a.el = g;

      g.addEventListener("pointerdown", function (e) { e.preventDefault(); onActivate(a); });
      g.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(a); }
      });
    });

    refreshStates();
  }

  function refreshStates() {
    var order = [];
    game.arrows.forEach(function (a) { if (a.state !== "REMOVED") order.push(a); });

    order.forEach(function (a) {
      var blocked = isBlocked(a, game.arrows, game.W, game.H);
      a.el.classList.toggle("is-blocked", blocked);
      a.el.classList.toggle("is-available", !blocked);
      if (blocked) a.el.setAttribute("aria-disabled", "true");
      else a.el.removeAttribute("aria-disabled");
      var idx = game.arrows.indexOf(a);
      a.el.setAttribute("aria-label", describe(a, idx));
    });

    var free = order.filter(function (a) {
      return !isBlocked(a, game.arrows, game.W, game.H);
    }).length;
    var left = order.length;
    if (game.status === "PLAYING" || game.status === "READY") {
      setStatus(left === 0 ? "" :
        free === 0 ? "Every exit is blocked. Look again." :
        free === 1 ? "One arrow can escape." :
        free + " arrows can escape. " + left + " on the board.");
    }
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function updateHud() {
    if (movesEl) movesEl.textContent = String(game.moves);
    if (levelEl) levelEl.textContent = "Level " + String(game.levelIndex + 1).padStart(2, "0");
    if (heartsEl) {
      var spans = heartsEl.querySelectorAll(".heart");
      spans.forEach(function (s, i) {
        s.classList.toggle("lost", i >= game.hearts);
      });
    }
  }

  // ============================================================
  // INTERACTION
  // ============================================================

  function onActivate(a) {
    if (game.status !== "PLAYING" && game.status !== "READY") return;
    if (a.state !== "IDLE") return;

    if (isBlocked(a, game.arrows, game.W, game.H)) {
      blockedTap(a);
      return;
    }
    extract(a);
  }

  function blockedTap(a) {
    game.hearts--;
    updateHud();
    setStatus("Blocked — the way out isn't clear. −1 heart");
    if (a.el && !reduced) {
      a.el.classList.remove("shake");
      void a.el.getBoundingClientRect();
      a.el.classList.add("shake");
    }
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }

    if (game.hearts <= 0) {
      game.status = "GAME_OVER";
      window.setTimeout(showGameOver, reduced ? 60 : 420);
    }
  }

  function extract(a) {
    game.status = "ANIMATING";
    a.state = "MOVING";
    a.el.classList.remove("is-available", "is-blocked");
    a.el.classList.add("is-moving");
    a.el.setAttribute("aria-disabled", "true");

    var dist = exitDistance(a, game.W, game.H);
    var d = DIRV[a.dir];
    var myEpoch = game.epoch;

    function finish() {
      if (myEpoch !== game.epoch) return; // restart happened mid-flight
      a.state = "REMOVED";
      if (a.el) a.el.remove();
      game.moves++;
      game.status = "PLAYING";
      updateHud();

      var left = game.arrows.filter(function (x) { return x.state !== "REMOVED"; }).length;
      if (left === 0) {
        win();
      } else {
        refreshStates();
      }
    }

    if (reduced) {
      a.el.style.opacity = "0";
      window.setTimeout(finish, 160);
      return;
    }

    var dur = Math.min(900, 300 + dist * 26);
    var anim = a.el.animate(
      [
        { transform: "translate(0px, 0px)", opacity: 1 },
        { transform: "translate(" + d[0] * dist + "px, " + d[1] * dist + "px)", opacity: 1, offset: 0.82 },
        { transform: "translate(" + d[0] * (dist + 1) + "px, " + d[1] * (dist + 1) + "px)", opacity: 0 },
      ],
      { duration: dur, easing: "cubic-bezier(0.55, 0.06, 0.45, 0.95)" }
    );
    var done = false;
    function onDone() {
      if (done) return;
      done = true;
      finish();
    }
    anim.onfinish = onDone;
    anim.oncancel = onDone;
    window.setTimeout(onDone, dur + 120); // safety net
  }

  // ============================================================
  // OVERLAYS
  // ============================================================

  function showOverlay(kicker, title, sub, primaryLabel, primaryAction, showHome) {
    if (!overlayEl) return;
    kickerEl.textContent = kicker;
    titleEl.textContent = title;
    subEl.textContent = sub;
    primaryBtn.textContent = primaryLabel;
    primaryBtn.onclick = primaryAction;
    homeLink.hidden = !showHome;
    overlayEl.classList.add("show");
    primaryBtn.focus();
  }

  function win() {
    game.status = "LEVEL_COMPLETE";
    setStatus("");
    window.setTimeout(function () {
      showOverlay(
        "Board clear",
        "Level complete",
        "You found your way out in " + game.moves + " moves — " +
          game.hearts + (game.hearts === 1 ? " heart" : " hearts") + " to spare.",
        "Next level →",
        function () { loadLevel(NEXT_OF[game.levelIndex]); },
        true
      );
    }, reduced ? 60 : 420);
  }

  function showGameOver() {
    setStatus("");
    showOverlay(
      "Out of hearts",
      "Game over",
      "The exit was blocked.",
      "Try again",
      function () { loadLevel(game.levelIndex); },
      true
    );
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  function loadLevel(idx) {
    game.levelIndex = idx;
    game.status = "READY";
    game.hearts = START_HEARTS;
    game.moves = 0;
    game.epoch++;

    if (overlayEl) overlayEl.classList.remove("show");
    buildBoard();
    updateHud();
    setStatus(idx === 0
      ? "Tap an arrow whose path to the edge is clear."
      : "Clear the board. Blocked taps cost a heart.");
  }

  function restart() {
    if (game.status === "ANIMATING") game.epoch++; // orphan in-flight exits
    loadLevel(game.levelIndex);
  }

  if (restartBtn) restartBtn.addEventListener("click", restart);
  document.addEventListener("keydown", function (e) {
    if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey && !e.altKey) restart();
  });

  // #level-N deep links (also the QA hook)
  var m = location.hash.match(/^#level-(\d+)$/);
  var start = m ? parseInt(m[1], 10) - 1 : 0;
  loadLevel(start >= 0 && start < LEVELS.length ? start : 0);
})();
