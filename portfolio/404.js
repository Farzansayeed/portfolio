// 404 — "Arrow Escape" · long-tail polyline edition · motion spec build
//
// Every arrow is ONE continuous axis-aligned polyline: a long tail with
// 90° bends and a single arrowhead. The FINAL segment's direction is the
// arrow's escape direction (bends in the tail don't change it). Tapping an
// arrow whose corridor to the edge is clear extracts it; blocked taps cost
// one of three hearts. Clear every arrow to escape the 404.
//
// MOTION LANGUAGE (translated from the Unity/DOTween spec to the web):
//   ESCAPE   anticipation (60ms pullback + head-only squash) → EaseInCubic
//            launch → dash-driven path extraction: the arrow slides out
//            through its own channel, head leading, the long tail visibly
//            following around every bend. Implemented on ONE extended path
//            with stroke-dasharray/dashoffset — corners are preserved, the
//            tail is never straightened, and nothing rigid-translates.
//   COLLIDE  70ms EaseOutQuad thrust → damped recoil with small overshoot
//            → decaying rotational shake → 1–2px board shake → #FF3344
//            flash peaking at impact, decaying over ~200ms.
//   SPAWN    staggered scale-in, 15ms per arrow, restrained overshoot.
//   HEARTS   burst → fracture/drop → settle into the empty slot (CSS).
//   VICTORY  board settle pulse before the completion overlay.
//
// Architecture:
//   LEVELS  frozen, solver-validated level data (offline-generated,
//           frozen as literals — nothing random at runtime)
//   LOGIC   pure functions over geometry: cell rasterization, corridor
//           trace, blocking, backtracking solver with state-hashing
//   STATE   gameStatus (READY/PLAYING/ANIMATING/LEVEL_COMPLETE/GAME_OVER),
//           per-arrow animation state machine (IDLE/ANTICIPATING/ESCAPING/
//           BLOCKED/RECOILING/ESCAPED), hearts, moves, epoch guard so no
//           animation survives a restart
//   RENDER  one SVG per level; each arrow = <g> with fat invisible hit
//           path, thin visible line (the extended extraction path), and a
//           head group wrapping the chevron (so the squash animation can
//           deform the head without fighting the per-frame transform)
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
  // MOTION CONSTANTS — the animation matrix (guidelines, not laws)
  // ============================================================

  var ANTICIPATE_MS = 60;      // escape phase 1: load up
  var RELEASE_MS = 80;         // pullback decay blended into the launch
  var LAUNCH_BASE_MS = 340;    // escape base duration
  var LAUNCH_PER_UNIT = 26;    // + path-length factor
  var LAUNCH_EXTRA_MAX = 480;  // clamped so long paths stay snappy
  var LAUNCH_MAX_MS = 950;

  var THRUST_MS = 70;          // collision phase 1: EaseOutQuad bump
  var RECOIL_MS = 330;         // collision phase 2: damped spring settle
  var THRUST_UNITS = 0.28;     // forward thrust distance
  var RECOIL_AMPL = 0.28;      // = THRUST_UNITS for velocity continuity
  var RECOIL_OMEGA = 6.9;      // damped spring frequency (rad)
  var RECOIL_DECAY = 4.5;      // damping
  var RATTLE_DEG = 18;         // rotational shake amplitude (±peak ~7°)
  var FLASH_PEAK_MS = 140;     // red flash holds past impact, then decays

  var SPAWN_STAGGER_MS = 15;   // per-arrow spawn delay
  var SPAWN_DUR_MS = 300;
  var HEART_BREAK_MS = 480;    // CSS animation (see 404.css)
  var VICTORY_SETTLE_MS = 560; // board pulse before the overlay
  var VICTORY_HOLD_MS = 620;

  var PULLBACK_UNITS = 0.12;   // anticipation distance
  var EDGE_MARGIN = 0.3;       // keep strokes fully past the board edge
  var HINT_PULSE_MS = 1000;    // hint loop, EaseInOutSine scale 1.00 → 1.14

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
      if (live[i] === a || live[i].state === "ESCAPED") continue;
      var cs = cellsOf(live[i]);
      for (var k in cs) occ[k] = true;
    }
    var cor = corridorOf(a, W, H);
    for (var j = 0; j < cor.length; j += 2) {
      if (occ[cor[j] + "," + cor[j + 1]]) return true;
    }
    return false;
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
      return false;
    }
    return rec();
  }

  // ============================================================
  // EASING + MATH
  // ============================================================

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeOutQuad(u) { return 1 - (1 - u) * (1 - u); }
  function easeInCubic(u) { return u * u * u; }

  function polyLen(pts) {
    var L = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      L += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
    }
    return L;
  }

  function bboxCenter(pts) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
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
  var hintBtn = document.getElementById("hint");
  var overlayEl = document.getElementById("overlay");
  var kickerEl = document.getElementById("overlay-kicker");
  var titleEl = document.getElementById("overlay-title");
  var subEl = document.getElementById("overlay-sub");
  var primaryBtn = document.getElementById("overlay-primary");
  var homeLink = document.getElementById("overlay-home");
  var boardFrame = document.querySelector(".board-frame");

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
        state: "IDLE",   // IDLE | ANTICIPATING | ESCAPING | BLOCKED | RECOILING | ESCAPED
        el: null,
        geom: null,
        centroid: null,
        spawnIndex: 0,
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

    sorted.forEach(function (a, spawnIdx) {
      a.spawnIndex = spawnIdx;

      // The visible line is the arrow's path EXTENDED past the head through
      // the escape corridor. Extraction then runs entirely on this one path
      // via dasharray/dashoffset: corners preserved, tail follows the head,
      // and the exited portion slides off through the edge.
      var n = a.pts.length;
      var hx = a.pts[n - 1][0], hy = a.pts[n - 1][1];
      var d = DIRV[a.dir];
      var headGap =
        a.dir === "R" ? L.W - hx :
        a.dir === "L" ? hx + 1 :
        a.dir === "D" ? L.H - hy : hy + 1;
      var totalLen = polyLen(a.pts);
      var runOut = headGap + 1.2 + EDGE_MARGIN;
      var ext = [hx + d[0] * runOut, hy + d[1] * runOut];
      var extD = pathD(a.pts) + " L " + ext[0] + " " + ext[1];
      a.geom = { totalLen: totalLen, headGap: headGap, extLen: totalLen + runOut };
      a.centroid = bboxCenter(a.pts);

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
        d: extD,
        class: "line",
        fill: "none",
        "stroke-width": "0.085",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      // head group carries the placement transform; the inner path is free
      // for the CSS squash animation (anticipation deforms ONLY the head —
      // the long tail stays geometrically coherent)
      var headG = el("g", {
        class: "head-g",
        transform: "translate(" + hx + " " + hy + ") rotate(" + DIR_ANGLE[a.dir] + ")",
      });
      var head = el("path", {
        d: "M -0.3 -0.3 L 0 0 L -0.3 0.3",
        class: "head",
        fill: "none",
        "stroke-width": "0.085",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      headG.appendChild(head);

      // resting state: only the arrow itself is visible — the dash window
      // covers exactly the arrow's own arc length, so the off-board
      // extension stays invisible until extraction consumes it
      line.setAttribute("stroke-dasharray", totalLen + " " + (a.geom.extLen + 60));
      line.setAttribute("stroke-dashoffset", "0");

      g.appendChild(hit);
      g.appendChild(line);
      g.appendChild(headG);
      svg.appendChild(g);
      a.el = g;

      g.addEventListener("pointerdown", function (e) { e.preventDefault(); onActivate(a); });
      g.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(a); }
      });
    });

    refreshStates();
    spawnArrows();
  }

  // Staggered entrance: scale 0 → slight overshoot → 1, 15ms per arrow.
  // The scale is a conjugated chain around the arrow's own centroid, so no
  // CSS transform-origin ambiguity can skew it.
  function spawnArrows() {
    var order = game.arrows.slice().sort(function (a, b) { return a.spawnIndex - b.spawnIndex; });
    order.forEach(function (a, i) {
      if (reduced) {
        a.el.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 120, delay: i * 4, fill: "backwards" });
        return;
      }
      var cx = a.centroid[0], cy = a.centroid[1];
      function at(s) {
        return "translate(" + cx + "px, " + cy + "px) scale(" + s + ") translate(" + (-cx) + "px, " + (-cy) + "px)";
      }
      a.el.animate(
        [
          { opacity: 0, transform: at(0.55) },
          { opacity: 1, transform: at(1.05), offset: 0.72 },
          { opacity: 1, transform: at(1) },
        ],
        { duration: SPAWN_DUR_MS, delay: i * SPAWN_STAGGER_MS,
          easing: "cubic-bezier(0.3, 1.2, 0.5, 1)", fill: "backwards" });
    });
  }

  function refreshStates() {
    var order = [];
    game.arrows.forEach(function (a) { if (a.state !== "ESCAPED") order.push(a); });

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

  // ---- Hint (§19–20): pulse a currently-valid arrow until it's used or
  // the level changes. Discoverable, but quiet — no neon glow.
  var hint = { target: null, anim: null };

  function stopHint() {
    if (hint.anim) hint.anim.cancel();
    hint.anim = null;
    if (hint.target && hint.target.el) {
      hint.target.el.classList.remove("is-hinted");
      hint.target.el.style.transform = "";
    }
    hint.target = null;
  }

  function startHint() {
    stopHint();
    if (reduced) return;
    if (game.status !== "PLAYING" && game.status !== "READY") return;
    var free = game.arrows.filter(function (a) {
      return a.state === "IDLE" && !isBlocked(a, game.arrows, game.W, game.H);
    });
    if (free.length === 0) { setStatus("Every exit is blocked. Look again."); return; }
    var a = free[Math.floor(Math.random() * free.length)];
    var cx = a.centroid[0], cy = a.centroid[1];
    hint.target = a;
    a.el.classList.add("is-hinted");
    a.el.style.transformOrigin = cx + "px " + cy + "px";
    a.el.style.transformBox = "view-box";
    hint.anim = a.el.animate(
      [
        { transform: "scale(1)", offset: 0 },
        { transform: "scale(1.14)", offset: 0.5 },
        { transform: "scale(1)", offset: 1 },
      ],
      { duration: HINT_PULSE_MS, iterations: Infinity, easing: "ease-in-out" });
  }

  if (hintBtn) hintBtn.addEventListener("click", startHint);

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function updateHud() {
    if (movesEl) movesEl.textContent = String(game.moves);
    if (levelEl) levelEl.textContent = "Level " + String(game.levelIndex + 1).padStart(2, "0");
    if (heartsEl) {
      var spans = heartsEl.querySelectorAll(".heart");
      spans.forEach(function (s, i) {
        if (i < game.hearts) s.classList.remove("fracturing"); // restored
        s.classList.toggle("lost", i >= game.hearts);
      });
    }
  }

  // ============================================================
  // INTERACTION — per-arrow animation state machine
  // ============================================================

  function onActivate(a) {
    if (game.status !== "PLAYING" && game.status !== "READY") return;
    if (a.state !== "IDLE") return; // ESCAPING/RECOILING ignore input until done
    stopHint(); // hint stops the moment its arrow (or any arrow) is chosen

    if (isBlocked(a, game.arrows, game.W, game.H)) {
      blockedTap(a);
      return;
    }
    extract(a);
  }

  // ---- COLLISION: thrust → recoil → settle (spec §12–17) ----

  function blockedTap(a) {
    game.hearts--;
    // the heart that just died fractures (CSS: burst → breakup → drop)
    if (heartsEl) {
      var span = heartsEl.querySelectorAll(".heart")[game.hearts];
      if (span) span.classList.add("fracturing");
    }
    updateHud();
    setStatus("Blocked — the way out isn't clear. −1 heart");
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }

    var myEpoch = game.epoch;
    var g = a.el;
    var d = DIRV[a.dir];
    var c = a.centroid;

    function done() {
      if (myEpoch !== game.epoch) return;
      a.state = "IDLE";
      g.removeAttribute("transform");
    }

    a.state = "BLOCKED";
    g.classList.add("is-hit");
    if (reduced) {
      // minimal response: color flash only, no motion
      window.setTimeout(function () {
        g.classList.remove("is-hit");
        done();
      }, 200);
    } else {
      // flash peaks at impact, decays via the base stroke transition
      window.setTimeout(function () {
        if (myEpoch === game.epoch) g.classList.remove("is-hit");
      }, FLASH_PEAK_MS);

      // screen shake: 1–2px on the board frame only, ~110ms
      if (boardFrame) boardFrame.animate(
        [
          { transform: "translate(0px, 0px)" },
          { transform: "translate(1.6px, -1px)" },
          { transform: "translate(-1.3px, 1px)" },
          { transform: "translate(0.8px, 0px)" },
          { transform: "translate(0px, 0px)" },
        ],
        { duration: 110, easing: "ease-out" });

      var start = performance.now();
      function frame(now) {
        if (myEpoch !== game.epoch) return; // restart orphans this animation
        var t = now - start;
        var off, rot;
        if (t <= THRUST_MS) {
          // EaseOutQuad thrust toward the blocker
          off = THRUST_UNITS * easeOutQuad(t / THRUST_MS);
          rot = 0;
        } else if (t < THRUST_MS + RECOIL_MS) {
          // damped spring: back past origin, small overshoot, settle
          a.state = "RECOILING";
          var u = (t - THRUST_MS) / RECOIL_MS;
          off = RECOIL_AMPL * Math.exp(-RECOIL_DECAY * u) * Math.cos(RECOIL_OMEGA * u);
          rot = RATTLE_DEG * Math.exp(-RECOIL_DECAY * u) * Math.sin(RECOIL_OMEGA * u);
        } else {
          done();
          return;
        }
        g.setAttribute("transform",
          "translate(" + (off * d[0]) + " " + (off * d[1]) + ") " +
          "rotate(" + rot + " " + c[0] + " " + c[1] + ")");
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    if (game.hearts <= 0) {
      game.status = "GAME_OVER";
      var ep = game.epoch;
      window.setTimeout(function () {
        if (ep !== game.epoch) return;
        showGameOver();
      }, reduced ? 60 : 420);
    }
  }

  // ---- ESCAPE: anticipation → launch → tail-follow extraction ----

  function extract(a) {
    game.status = "ANIMATING";
    a.state = "ANTICIPATING";
    a.el.classList.remove("is-available", "is-blocked");
    a.el.classList.add("is-moving", "is-anticipating");
    a.el.setAttribute("aria-disabled", "true");

    var myEpoch = game.epoch;
    var g = a.el;
    var d = DIRV[a.dir];
    var geom = a.geom;
    var line = g.querySelector(".line");
    var headG = g.querySelector(".head-g");
    var angle = DIR_ANGLE[a.dir];

    function finish() {
      if (myEpoch !== game.epoch) return; // restart happened mid-flight
      a.state = "ESCAPED";
      if (a.el) a.el.remove();
      game.moves++;
      game.status = "PLAYING";
      updateHud();

      var left = game.arrows.filter(function (x) { return x.state !== "ESCAPED"; }).length;
      if (left === 0) {
        win();
      } else {
        refreshStates();
      }
    }

    if (reduced) {
      // no anticipation, no extraction choreography — short fade, still ordered
      a.state = "ESCAPING";
      a.el.style.opacity = "0";
      window.setTimeout(function () {
        if (myEpoch === game.epoch) finish();
      }, 160);
    } else {

    // duration scales with real path travel, clamped so long tails stay snappy
    var dur = Math.min(LAUNCH_MAX_MS,
      LAUNCH_BASE_MS + clamp((geom.totalLen + geom.headGap) * LAUNCH_PER_UNIT, 0, LAUNCH_EXTRA_MAX));

    var start = performance.now();
    var launched = false;

    function frame(now) {
      if (myEpoch !== game.epoch) return;
      var t = now - start;

      // Phase 1 — anticipation: the whole arrow loads backward a hair; the
      // squash is head-only (CSS), the tail never deforms.
      if (t < ANTICIPATE_MS) {
        var pull = PULLBACK_UNITS * easeOutQuad(t / ANTICIPATE_MS);
        g.setAttribute("transform", "translate(" + (-pull * d[0]) + " " + (-pull * d[1]) + ")");
        requestAnimationFrame(frame);
        return;
      }

      // Phase 2 — launch: EaseInCubic progress along the extended path.
      // (is-anticipating stays: its squash animation self-completes and
      // normalizes the head back to scale 1 — removing it here would snap.)
      if (!launched) {
        launched = true;
        a.state = "ESCAPING";
      }
      var lt = Math.min(1, (t - ANTICIPATE_MS) / dur);
      var L = easeInCubic(lt) * geom.extLen; // extraction front, in arc units

      // release the pullback during the first moments of the launch
      var rel = 1 - clamp((t - ANTICIPATE_MS) / RELEASE_MS, 0, 1);
      var pb = PULLBACK_UNITS * rel;
      g.setAttribute("transform", "translate(" + (-pb * d[0]) + " " + (-pb * d[1]) + ")");

      // Path extraction: the dash window [L, L+vis] slides along the
      // extended path. The tail end advances through the bends (corners
      // intact) while the front is consumed past the board edge — the long
      // tail visibly follows the head out. No rigid translate of the shape.
      var vis = Math.min(geom.totalLen, geom.extLen - L);
      if (vis <= 0.01) {
        line.style.opacity = "0";
      } else {
        line.style.opacity = "";
        line.setAttribute("stroke-dasharray", vis + " " + (geom.extLen + 60));
        line.setAttribute("stroke-dashoffset", String(-L));
      }

      // the chevron rides the front and dies past the viewBox edge
      if (L < geom.headGap + 0.75) {
        var p = line.getPointAtLength(Math.min(geom.totalLen + L, geom.extLen - 0.01));
        headG.setAttribute("transform", "translate(" + p.x + " " + p.y + ") rotate(" + angle + ")");
      } else {
        headG.style.display = "none";
      }

      if (vis <= 0.01) {
        finish();
        return;
      }
      if (lt < 1) {
        requestAnimationFrame(frame);
      } else {
        finish();
      }
    }
    requestAnimationFrame(frame);
    }
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
    var ep = game.epoch;

    // Victory: let the board settle — a soft radial pulse — before the
    // overlay claims the moment. Never explode into particles.
    if (!reduced && boardFrame) {
      boardFrame.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(0.985)" },
          { transform: "scale(1.004)" },
          { transform: "scale(1)" },
        ],
        { duration: VICTORY_SETTLE_MS, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" });
    }

    window.setTimeout(function () {
      if (ep !== game.epoch) return; // restarted during the settle
      showOverlay(
        "Board clear",
        "Level complete",
        "You found your way out in " + game.moves + " moves — " +
          game.hearts + (game.hearts === 1 ? " heart" : " hearts") + " to spare.",
        "Next level →",
        function () { loadLevel(NEXT_OF[game.levelIndex]); },
        true
      );
    }, reduced ? 80 : VICTORY_HOLD_MS);
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
    game.epoch++; // every in-flight animation is now orphaned
    stopHint();   // the hint never survives a level change or restart

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
