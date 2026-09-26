// 404 — "Arrow Escape" · traversable trajectory edition
//
// Every arrow is ONE continuous axis-aligned polyline: a long tail with
// 90° bends and a single arrowhead. The FINAL segment's direction is the
// arrow's escape direction (bends in the tail don't change it). Tapping an
// arrow whose corridor to the edge is clear sends the arrowhead travelling
// through its actual winding route; blocked taps run the head forward until
// it physically hits the blocker, flash, and retrace the exact path back.
// Clear every arrow to escape the 404.
//
// MOTION LANGUAGE (per the traversable-trajectory spec):
//   TRAVERSE the arrowhead moves through the waypoint path at ~18 grid
//            units/s, continuously — no teleporting between waypoints, no
//            snapping at corners. The head's tangent rotates through each
//            bend over ~40ms; the geometry itself stays rigid.
//   COLLIDE  forward approach at traverse speed → stop 0.15 units short of
//            the blocking geometry → impact flash to #FF3344 → brief hold
//            → REVERSAL: the traversal parameter runs backward through the
//            exact travelled arc (never a straight-line shortcut, never a
//            group translate) at 1.4× speed with exponential deceleration,
//            then the arrow restores to its original resting appearance.
//   ESCAPE   traversal to the board boundary → EaseInCubic exit
//            acceleration past the edge → 100ms fade → removed from the
//            spatial state; dependencies recalculated.
//   SPAWN    staggered scale-in, 15ms per arrow, restrained overshoot.
//   HEARTS   lost at impact; burst → fracture/drop → settle into the
//            empty slot (CSS).
//   VICTORY  waits for the final arrow's fade, board settle pulse, banner
//            entrance (scale 0 → 1.2 → 1.0), quiet pooled canvas confetti.
//
// Implementation notes:
//   - The single traversal variable is s = arc distance travelled along
//     the fixed extended path. Movement history is parametric (segment
//     index + distance along segment are recovered from s in O(segments));
//     reversal is simply s running from impactS back to 0 — the path is
//     never re-sampled, never straightened, and the <g> never translates.
//   - Visibility is one dash window [s, s + totalLen] on the extended
//     path: the same update serves forward traversal, reversal, and exit.
//   - States: IDLE MOVING COLLIDING REVERSING ESCAPING ESCAPED. An arrow
//     remains an obstacle until it is fully ESCAPED (geometry cleared).
//   - Epoch guard orphans every in-flight animation on restart/level change.
//
// Vanilla JS + SVG + Canvas. No dependencies. Honors prefers-reduced-motion.
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

  var TRAVERSE_SPEED = 18;     // logical grid units / second (internal traversal)
  var CORNER_TURN_MS = 40;     // head tangent interpolation across a bend
  var IMPACT_GAP = 0.15;       // stop this far short of blocking geometry
  var IMPACT_MIN_MS = 80;      // shortest forward approach (near-adjacent blocker)
  var IMPACT_HOLD_MS = 50;     // freeze at the impact point before reversing
  var THRUST_MS = 70;          // small impact bump into the blocker
  var THRUST_UNITS = 0.08;     //   (0.15 − 0.08 keeps a hair of daylight:
                               //    contact read, never overlap)
  var REVERSE_SPEED_MULT = 1.4;// reversal speed vs traverse speed
  var REVERSE_DECEL = 1.2;     // exponential deceleration during reversal
  var REVERSE_TAIL_V = 0.45;   // fraction of start speed held until arrival
  var REVERSE_MIN_MS = 140;    // floor so short retraces still read as motion
  var FLASH_PEAK_MS = 140;     // red flash holds past impact, then decays
  var EXIT_FADE_MS = 100;      // fade of whatever tail remains mid-exit
  var EXIT_AVG_MULT = 1.6;     // exit average speed vs traverse speed
  var EXIT_BLEND = 0.625;      // linear/cubic blend: accelerating, yet joins
                               // the boundary exactly at the traverse speed
  var EXIT_MS_MIN = 110;
  var EXIT_MS_MAX = 620;

  var ANTICIPATE_MS = 60;      // load-up before any run
  var RELEASE_MS = 80;         // pullback decay blended into the launch
  var PULLBACK_UNITS = 0.12;   // anticipation distance
  var SPAWN_STAGGER_MS = 15;   // per-arrow spawn delay
  var SPAWN_DUR_MS = 300;
  var HEART_BREAK_MS = 480;    // CSS animation (see 404.css)
  var VICTORY_SETTLE_MS = 560; // board pulse before the overlay
  var VICTORY_HOLD_MS = 620;
  var VICTORY_WAIT_MS = 160;   // grace after the final fade before victory

  var EDGE_MARGIN = 0.3;       // keep strokes fully past the board edge
  var HINT_PULSE_MS = 1000;    // hint loop, EaseInOutSine scale 1.00 → 1.14

  // confetti — pooled canvas particles, deliberately quiet
  var CONFETTI_POOL = 160;
  var CONFETTI_PER_EMITTER = 34;
  var CONFETTI_LIFE_MIN = 1.2; // seconds
  var CONFETTI_LIFE_MAX = 2.2;
  var CONFETTI_SPEED_MIN = 14; // units / s (1 unit = board height / 14)
  var CONFETTI_SPEED_MAX = 22;
  var CONFETTI_GRAVITY = 1.15; // units / s²
  var CONFETTI_DRAG = 1.8;     // exponential drag / s

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

  function occupancyOf(live, exclude) {
    var occ = {};
    for (var i = 0; i < live.length; i++) {
      var o = live[i];
      if (o === exclude || o.state === "ESCAPED") continue;
      var cs = cellsOf(o);
      for (var k in cs) occ[k] = true;
    }
    return occ;
  }

  function isBlocked(a, live, W, H) {
    return blockedDistance(a, occupancyOf(live, a), W, H) < Infinity;
  }

  // Distance (in arc units along the extended path) the head can travel
  // before reaching the first blocking point, minus the impact gap —
  // Infinity when the corridor to the edge is clear. Obstacles = points of
  // every other arrow not yet ESCAPED. corridor[k] sits k+1 units beyond
  // the head, hence the +1.
  function blockedDistance(a, occ, W, H) {
    var cor = corridorOf(a, W, H);
    for (var j = 0; j < cor.length; j += 2) {
      if (occ[cor[j] + "," + cor[j + 1]]) {
        return Math.max(0, j / 2 + 1 - IMPACT_GAP);
      }
    }
    return Infinity;
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

  // shortest-path angular interpolation (degrees)
  function angLerp(a, b, u) {
    var d = ((b - a) % 360 + 540) % 360 - 180;
    return a + d * u;
  }

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
  var fxCanvas = document.getElementById("fx");
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

  // ---- Path parameterization (the traversal core) ----
  // The extended path = the arrow's own polyline plus one straight run-out
  // segment past the head. Segment lengths give an exact arc-length map:
  // s (arc units) → {x, y, tangent angle}. This IS the movement history:
  // segment index + distance-along-segment are recovered from s directly.

  function buildGeom(a, L) {
    var pts = a.pts.slice();
    var n = pts.length;
    var hx = pts[n - 1][0], hy = pts[n - 1][1];
    var d = DIRV[a.dir];
    var headGap =
      a.dir === "R" ? L.W - hx :
      a.dir === "L" ? hx + 1 :
      a.dir === "D" ? L.H - hy : hy + 1;
    var runOut = headGap + 1.2 + EDGE_MARGIN;
    pts.push([hx + d[0] * runOut, hy + d[1] * runOut]);

    var segLens = [], segAcc = [0], total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var len = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
      segLens.push(len);
      total += len;
      segAcc.push(total);
    }
    return {
      totalLen: total - runOut,       // arc length of the arrow's own body
      extLen: total,                  // including the run-out past the edge
      headGap: headGap,
      segLens: segLens,
      segAcc: segAcc,
      pts: pts,
      runOut: runOut,
    };
  }

  function pathTo(a, s) {
    var g = a.geom, pts = g.pts;
    var i = 0, last = g.segLens.length - 1;
    while (i < last && s > g.segAcc[i + 1]) i++;
    var ls = s - g.segAcc[i];
    var x1 = pts[i][0], y1 = pts[i][1];
    var ux = 0, uy = 0, len = g.segLens[i];
    if (len > 0) { ux = (pts[i + 1][0] - x1) / len; uy = (pts[i + 1][1] - y1) / len; }
    return {
      x: x1 + ux * ls,
      y: y1 + uy * ls,
      ang: Math.atan2(uy, ux) * 180 / Math.PI,
    };
  }

  // ---- Board build ----

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
        state: "IDLE", // IDLE | MOVING | COLLIDING | REVERSING | ESCAPING | ESCAPED
        el: null,
        geom: null,
        centroid: null,
        spawnIndex: 0,
        runS: 0,       // current traversal position (arc units along ext path)
        ha: null,      // per-arrow head-angle smoothing state
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

      // The visible line is the FULL extended path; a dash window shows
      // exactly the arrow's own arc length at rest. Traversal slides that
      // window along the path — forward, backward (reversal), and out
      // (exit) are all the same mechanism driven by one variable, s.
      var aGeom = buildGeom(a, L);
      a.geom = aGeom;
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
        d: pathD(aGeom.pts),
        class: "line",
        fill: "none",
        "stroke-width": "0.085",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      // head group carries the placement transform; the inner path is free
      // for the CSS squash animation (anticipation deforms ONLY the head —
      // the long tail stays geometrically coherent)
      var n = a.pts.length;
      var headG = el("g", {
        class: "head-g",
        transform: "translate(" + a.pts[n - 1][0] + " " + a.pts[n - 1][1] + ") rotate(" + DIR_ANGLE[a.dir] + ")",
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

      // resting state: the dash window covers exactly the arrow's own arc
      // length — the off-board extension stays invisible until the run
      line.setAttribute("stroke-dasharray", aGeom.totalLen + " " + (aGeom.extLen + 60));
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
      if (a.state !== "IDLE") return; // mid-run arrows keep their run classes
      var blocked = isBlocked(a, game.arrows, game.W, game.H);
      a.el.classList.toggle("is-blocked", blocked);
      a.el.classList.toggle("is-available", !blocked);
      if (blocked) a.el.setAttribute("aria-disabled", "true");
      else a.el.removeAttribute("aria-disabled");
      var idx = game.arrows.indexOf(a);
      a.el.setAttribute("aria-label", describe(a, idx));
    });

    var idle = order.filter(function (a) { return a.state === "IDLE"; });
    var free = idle.filter(function (a) {
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
  // TRAVERSAL ENGINE — shared run mechanics
  // ============================================================

  // Place the arrow for traversal position s: dash window [s, s+totalLen],
  // head riding the front at s + totalLen with corner-smoothed rotation.
  // One mechanism serves forward travel, reversal, and exit.
  function placeAt(a, s, now) {
    var g = a.geom, line = a.el.querySelector(".line"), headG = a.el.querySelector(".head-g");
    a.runS = s;

    var vis = Math.min(g.totalLen, g.extLen - s);
    if (vis <= 0.01) {
      line.style.opacity = "0";
    } else {
      line.style.opacity = "";
      line.setAttribute("stroke-dasharray", vis + " " + (g.extLen + 60));
      line.setAttribute("stroke-dashoffset", String(-s));
    }

    var hs = s + g.totalLen;
    if (hs > g.extLen - 0.2) {
      headG.style.display = "none";
      return;
    }
    headG.style.display = "";
    var p = pathTo(a, hs);

    // tangent rotation: ease toward the segment angle over ~40ms so bends
    // read as turns, never snaps
    var ha = a.ha || (a.ha = { shown: headAngle0(a), from: 0, to: 0, at: -1e9 });
    if (p.ang !== ha.to) {
      ha.from = ha.shown;
      ha.to = p.ang;
      ha.at = now;
    }
    var u = clamp((now - ha.at) / CORNER_TURN_MS, 0, 1);
    ha.shown = angLerp(ha.from, ha.to, easeOutQuad(u));
    headG.setAttribute("transform",
      "translate(" + p.x + " " + p.y + ") rotate(" + ha.shown + ")");
  }

  function headAngle0(a) { return DIR_ANGLE[a.dir]; }

  function resetHead(a) {
    var n = a.pts.length;
    a.ha = null;
    var headG = a.el.querySelector(".head-g");
    headG.style.display = "";
    headG.setAttribute("transform",
      "translate(" + a.pts[n - 1][0] + " " + a.pts[n - 1][1] + ") rotate(" + DIR_ANGLE[a.dir] + ")");
  }

  function restoreIdle(a) {
    var line = a.el.querySelector(".line");
    line.style.opacity = "";
    line.setAttribute("stroke-dasharray", a.geom.totalLen + " " + (a.geom.extLen + 60));
    line.setAttribute("stroke-dashoffset", "0");
    a.el.removeAttribute("transform");
    a.el.style.opacity = "";
    resetHead(a);
    a.runS = 0;
    a.state = "IDLE";
    // is-anticipating is dropped only here: its 240ms squash has fully run
    // by the time a blocked approach + reversal completes, so removing it
    // can't snap the chevron — and the next tap gets a fresh animation.
    a.el.classList.remove("is-moving", "is-hit", "is-reversing", "is-anticipating");
    refreshStates();
  }

  // Anticipation: whole-arrow pullback + head squash (CSS), shared by both
  // run types. Calls begin() when the load-up completes.
  function anticipate(a, myEpoch, begin) {
    a.el.classList.add("is-moving", "is-anticipating");
    a.el.setAttribute("aria-disabled", "true");
    a.el.classList.remove("is-available", "is-blocked");

    if (reduced) { begin(); return; }

    var g = a.el;
    var d = DIRV[a.dir];
    var start = performance.now();

    function pull(now) {
      if (myEpoch !== game.epoch) return;
      var t = now - start;
      if (t < ANTICIPATE_MS) {
        var p = PULLBACK_UNITS * easeOutQuad(t / ANTICIPATE_MS);
        g.setAttribute("transform", "translate(" + (-p * d[0]) + " " + (-p * d[1]) + ")");
        requestAnimationFrame(pull);
      } else {
        begin(); // traversal keeps blending the pullback out (RELEASE_MS)
      }
    }
    requestAnimationFrame(pull);
  }

  // Decay the anticipation pullback during the first moments of travel.
  function releasePullback(a, elapsedMs) {
    if (reduced) return;
    var rel = 1 - clamp(elapsedMs / RELEASE_MS, 0, 1);
    var d = DIRV[a.dir];
    a.el.setAttribute("transform",
      "translate(" + (-PULLBACK_UNITS * rel * d[0]) + " " + (-PULLBACK_UNITS * rel * d[1]) + ")");
    if (rel <= 0) a.el.removeAttribute("transform");
  }

  // ============================================================
  // INTERACTION
  // ============================================================

  function onActivate(a) {
    if (game.status !== "PLAYING" && game.status !== "READY") return;
    if (a.state !== "IDLE") return; // mid-run arrows ignore input until done
    if (game.hearts <= 0) return;   // game over already locked in
    stopHint(); // hint stops the moment its arrow (or any arrow) is chosen

    if (isBlocked(a, game.arrows, game.W, game.H)) {
      blockedRun(a);
      return;
    }
    escapeRun(a);
  }

  // ---- BLOCKED RUN: approach → impact → parametric reversal ----

  function loseHeart() {
    game.hearts--;
    // the heart that just died fractures (CSS: burst → breakup → drop)
    if (heartsEl) {
      var span = heartsEl.querySelectorAll(".heart")[game.hearts];
      if (span) span.classList.add("fracturing");
    }
    updateHud();
    setStatus("Blocked — the way out isn't clear. −1 heart");
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }

  function blockedRun(a) {
    var myEpoch = game.epoch;

    if (reduced) {
      // reduced motion: no travel, no reversal — impact flash + heart cost
      a.state = "COLLIDING";
      a.el.classList.add("is-hit");
      loseHeart();
      window.setTimeout(function () {
        if (myEpoch !== game.epoch) return;
        a.el.classList.remove("is-hit");
        restoreIdle(a);
        afterHeartLoss();
      }, 200);
      return;
    }

    var occ = occupancyOf(game.arrows, a);
    var stopS = blockedDistance(a, occ, game.W, game.H);
    if (stopS === Infinity) { escapeRun(a); return; } // state raced; escape instead

    a.state = "MOVING";
    a.el.classList.remove("is-hit", "is-reversing");

    var approachMs = Math.max(IMPACT_MIN_MS, (stopS / TRAVERSE_SPEED) * 1000);
    var approachStart = 0;

    anticipate(a, myEpoch, function begin() {
      if (myEpoch !== game.epoch) return;
      approachStart = performance.now();
      requestAnimationFrame(approach);
    });

    // Phase 1a — forward approach at constant traverse speed. The dash
    // window slides forward; the head leads through every bend.
    function approach(now) {
      if (myEpoch !== game.epoch) return;
      var t = now - approachStart;
      releasePullback(a, t);
      var u = clamp(t / approachMs, 0, 1);
      placeAt(a, stopS * u, now);
      if (u < 1) { requestAnimationFrame(approach); return; }

      // Phase 1b — impact: thrust bump, red flash, brief hold.
      impact(now);
    }

    function impact(now) {
      if (myEpoch !== game.epoch) return;
      a.state = "COLLIDING";
      loseHeart();

      a.el.classList.add("is-hit");
      window.setTimeout(function () {
        if (myEpoch === game.epoch) a.el.classList.remove("is-hit");
      }, FLASH_PEAK_MS);

      if (boardFrame) boardFrame.animate(
        [
          { transform: "translate(0px, 0px)" },
          { transform: "translate(1.6px, -1px)" },
          { transform: "translate(-1.3px, 1px)" },
          { transform: "translate(0.8px, 0px)" },
          { transform: "translate(0px, 0px)" },
        ],
        { duration: 110, easing: "ease-out" });

      // small thrust bump into the blocker (EaseOutQuad), then hold
      var d = DIRV[a.dir];
      var thrustStart = performance.now();
      function bump(now2) {
        if (myEpoch !== game.epoch) return;
        var t2 = now2 - thrustStart;
        if (t2 < THRUST_MS) {
          var off = THRUST_UNITS * easeOutQuad(t2 / THRUST_MS);
          a.el.setAttribute("transform", "translate(" + (off * d[0]) + " " + (off * d[1]) + ")");
          requestAnimationFrame(bump);
          return;
        }
        a.el.removeAttribute("transform");
        window.setTimeout(function () {
          if (myEpoch === game.epoch) reverse(performance.now());
        }, IMPACT_HOLD_MS);
      }
      requestAnimationFrame(bump);
    }

    // Phase 2 — REVERSAL: the traversal parameter runs backward through the
    // exact travelled arc (s: stopS → 0). Never a straight-line shortcut,
    // never a group translate. Velocity starts at 1.4× traverse speed and
    // decays exponentially toward a floor, so the arrow glides home and
    // settles rather than slamming to a halt.
    function reverse(now) {
      if (myEpoch !== game.epoch) return;
      a.state = "REVERSING";
      a.el.classList.add("is-reversing");

      var v1 = TRAVERSE_SPEED * REVERSE_SPEED_MULT;
      var vEnd = Math.max(6, v1 * REVERSE_TAIL_V);
      var tNat = reverseArrivalTime(stopS, v1, vEnd, REVERSE_DECEL);
      var T = Math.max(tNat, REVERSE_MIN_MS / 1000); // floor for tiny retraces
      var revStart = performance.now();

      function frame(now2) {
        if (myEpoch !== game.epoch) return;
        var el2 = now2 - revStart;
        releasePullback(a, approachMs + el2); // pullback fully released by now
        // time-remap (monotone composition) keeps the profile monotonic
        var t = Math.min(el2 / 1000 * (tNat / T), tNat);
        var d = vEnd * t + (v1 - vEnd) * (1 - Math.exp(-REVERSE_DECEL * t)) / REVERSE_DECEL;
        placeAt(a, Math.max(0, stopS - d), now2);
        if (el2 < T * 1000) { requestAnimationFrame(frame); return; }

        // back home — restore the resting appearance and availability
        restoreIdle(a);
        afterHeartLoss();
      }
      requestAnimationFrame(frame);
    }
  }

  function afterHeartLoss() {
    if (game.hearts <= 0 && game.status !== "GAME_OVER") {
      game.status = "GAME_OVER";
      var ep = game.epoch;
      window.setTimeout(function () {
        if (ep !== game.epoch) return;
        showGameOver();
      }, reduced ? 60 : 420);
    }
  }

  // Arrival time for the reversal velocity profile: v(t) = vEnd +
  // (v1 − vEnd)·e^(−k·t); distance D(t) = vEnd·t + (v1 − vEnd)(1−e^(−k·t))/k.
  // D is strictly monotone, so bisection lands on t* where D(t*) = total.
  function reverseArrivalTime(total, v1, vEnd, k) {
    var lo = 0, hi = total / vEnd + 1;
    for (var i = 0; i < 48; i++) {
      var mid = (lo + hi) / 2;
      var d = vEnd * mid + (v1 - vEnd) * (1 - Math.exp(-k * mid)) / k;
      if (d < total) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- ESCAPE RUN: traversal → boundary → exit acceleration → fade ----

  function escapeRun(a) {
    game.status = "ANIMATING";
    var myEpoch = game.epoch;
    var g = a.geom;
    var corridorEnd = g.headGap; // s at which the head reaches the boundary
    // accelerated slide that carries the whole body past the edge, ending
    // ~0.9 units of tail short — exactly the nub the 100ms fade retires
    var exitDist = g.totalLen + 0.6;

    a.state = "MOVING";

    var finishGuard = false;
    function finishEscape() {
      if (finishGuard) return;
      finishGuard = true;
      if (myEpoch !== game.epoch) return; // restart happened mid-flight
      a.state = "ESCAPED";
      if (a.el) a.el.remove();
      game.moves++;
      game.status = "PLAYING";
      updateHud();

      var left = game.arrows.filter(function (x) { return x.state !== "ESCAPED"; }).length;
      if (left === 0) {
        // victory waits until the final arrow's fade has fully finished
        var ep = game.epoch;
        window.setTimeout(function () {
          if (ep !== game.epoch) return;
          win();
        }, reduced ? 80 : VICTORY_WAIT_MS);
      } else {
        refreshStates();
      }
    }

    if (reduced) {
      // no traversal choreography — short fade, still ordered
      a.state = "ESCAPING";
      a.el.style.opacity = "0";
      window.setTimeout(function () {
        if (myEpoch === game.epoch) finishEscape();
      }, 160);
      return;
    }

    anticipate(a, myEpoch, function begin() {
      if (myEpoch !== game.epoch) return;
      var start = performance.now();
      var phase = "TRAVERSE"; // TRAVERSE → EXIT → FADE
      var exitStart = 0;
      var fadeStart = 0;
      var exitMs = clamp(exitDist / (TRAVERSE_SPEED * EXIT_AVG_MULT) * 1000,
        EXIT_MS_MIN, EXIT_MS_MAX);

      function frame(now) {
        if (myEpoch !== game.epoch) return;
        var t = now - start;

        if (phase === "TRAVERSE") {
          releasePullback(a, t);
          var s = Math.min(TRAVERSE_SPEED * (t / 1000), corridorEnd);
          placeAt(a, s, now);
          if (s >= corridorEnd) {
            phase = "EXIT";
            a.state = "ESCAPING"; // no longer returnable; still an obstacle
            exitStart = now;      // until the geometry has cleared
          }
          requestAnimationFrame(frame);
          return;
        }

        if (phase === "EXIT") {
          // EaseInCubic-style acceleration out through the run-out, tail
          // following around every bend. Blended with a linear term so the
          // curve joins the boundary at most of the traverse speed instead
          // of hitching to zero.
          var u = clamp((now - exitStart) / exitMs, 0, 1);
          var f = (1 - EXIT_BLEND) * easeInCubic(u) + EXIT_BLEND * u;
          placeAt(a, corridorEnd + exitDist * f, now);
          if (u >= 1) {
            phase = "FADE";
            fadeStart = now;
          }
          requestAnimationFrame(frame);
          return;
        }

        // FADE — ~100ms opacity fade; the geometry is already past the edge
        var fu = clamp((now - fadeStart) / EXIT_FADE_MS, 0, 1);
        a.el.style.opacity = String(1 - fu);
        if (fu < 1) { requestAnimationFrame(frame); return; }
        finishEscape();
      }
      requestAnimationFrame(frame);
    });
  }

  // ============================================================
  // CONFETTI — pooled canvas particles (victory only, deliberately quiet)
  // ============================================================

  var fx = {
    running: false, pool: [], raf: 0, ctx: null,
    unitPx: 10, last: 0, epoch: 0,
  };

  function fxInit() {
    if (!fxCanvas || !boardFrame) return false;
    if (fx.pool.length) return true;
    fx.ctx = fxCanvas.getContext("2d");
    var colors = ["#d3a95c", "#e6c483", "#f4f2ee"];
    for (var i = 0; i < CONFETTI_POOL; i++) {
      fx.pool.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, rot: 0, rv: 0, w: 0, h: 0, life: 0, age: 0, color: colors[i % colors.length] });
    }
    return true;
  }

  function fxResize() {
    if (!fxCanvas) return;
    var r = boardFrame.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    fxCanvas.width = Math.max(1, Math.round(r.width * dpr));
    fxCanvas.height = Math.max(1, Math.round(r.height * dpr));
    fx.unitPx = r.height / 14; // 1 logical unit ≈ board scale
    fx.dpr = dpr;
    fx.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px
  }

  function fxLaunch() {
    if (reduced || !fxInit()) return;
    fxResize();
    fx.epoch = game.epoch;
    fx.last = performance.now();
    var w = fxCanvas.width / (fx.dpr || 1);
    var h = fxCanvas.height / (fx.dpr || 1);
    var emitters = [
      { x: w * 0.12, y: h + 6, delay: 0 },
      { x: w * 0.88, y: h + 6, delay: 120 },
    ];
    emitters.forEach(function (em) {
      var ep = game.epoch;
      window.setTimeout(function () {
        if (ep !== game.epoch) return;
        var spawned = 0;
        for (var i = 0; i < fx.pool.length && spawned < CONFETTI_PER_EMITTER; i++) {
          var p = fx.pool[i];
          if (p.alive) continue;
          var speed = (CONFETTI_SPEED_MIN + Math.random() * (CONFETTI_SPEED_MAX - CONFETTI_SPEED_MIN)) * fx.unitPx;
          var ang = (-90 + (Math.random() * 110 - 55)) * Math.PI / 180; // ±55° upward fan
          p.alive = true;
          p.x = em.x; p.y = em.y;
          p.vx = Math.cos(ang) * speed;
          p.vy = Math.sin(ang) * speed;
          p.rot = Math.random() * Math.PI * 2;
          p.rv = (Math.random() * 7 - 3.5);
          p.w = (4 + Math.random() * 4);
          p.h = 2 + Math.random() * 1.5;
          p.life = CONFETTI_LIFE_MIN + Math.random() * (CONFETTI_LIFE_MAX - CONFETTI_LIFE_MIN);
          p.age = 0;
          spawned++;
        }
        if (!fx.running) { fx.running = true; fx.last = performance.now(); fx.raf = requestAnimationFrame(fxFrame); }
      }, em.delay);
    });
  }

  function fxFrame(now) {
    if (!fx.running) return;
    var dt = Math.min(0.05, (now - fx.last) / 1000);
    fx.last = now;
    var ctx = fx.ctx;
    var w = fxCanvas.width / fx.dpr, h = fxCanvas.height / fx.dpr;
    var g = CONFETTI_GRAVITY * fx.unitPx;
    var drag = Math.exp(-CONFETTI_DRAG * dt);
    ctx.clearRect(0, 0, w, h);
    var anyAlive = false;

    for (var i = 0; i < fx.pool.length; i++) {
      var p = fx.pool[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      p.vy += g * dt;
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.rv * dt;
      var fade = 1 - easeInCubic(p.age / p.life);
      ctx.save();
      ctx.globalAlpha = 0.85 * fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      anyAlive = true;
    }

    if (anyAlive && fx.epoch === game.epoch) {
      fx.raf = requestAnimationFrame(fxFrame);
    } else {
      fx.running = false;
      ctx.clearRect(0, 0, w, h);
    }
  }

  function fxStop() {
    fx.running = false;
    if (fx.raf) cancelAnimationFrame(fx.raf);
    if (fx.ctx && fxCanvas) {
      fx.ctx.clearRect(0, 0, fxCanvas.width / (fx.dpr || 1), fxCanvas.height / (fx.dpr || 1));
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
    overlayEl.classList.remove("show");
    // restart the banner entrance (scale 0 → 1.2 → 1.0) on every show
    void overlayEl.offsetWidth;
    overlayEl.classList.add("show");
    primaryBtn.focus();
  }

  function win() {
    game.status = "LEVEL_COMPLETE";
    setStatus("");
    var ep = game.epoch;

    // Victory: let the board settle — a soft radial pulse — then the quiet
    // confetti and the banner entrance. Never explode into a spectacle.
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
    if (!reduced) fxLaunch();

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
    fxStop();

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
