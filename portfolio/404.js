// 404 — "Arrow Escape"
// Every arrow wants to leave the board in the direction it points. An arrow
// may exit only when its entire forward path to the edge is clear; removing
// one arrow can unblock others. Clear the board.
//
// Architecture (logic independent of rendering):
//   STATE    level index, arrow records { id, c, r, dir, state }, moves,
//            busy lock, epoch counter (invalidates in-flight animations)
//   LOGIC    pure functions over { cols, rows, arrows }: occupancy set,
//            forward-path trace, removability, greedy solver (removals are
//            monotone, so greedy = optimal), reverse-construction generator
//   RENDER   one <button> per arrow, absolutely positioned via transforms
//   NAV      restart · next level · home
//
// Monotonicity: removing an arrow never blocks another (paths only clear),
// so a solvable board stays solvable under any legal removal — deadlocks are
// impossible during play, and any currently-removable arrow is a safe hint.
// Vanilla JS, no dependencies. Respects prefers-reduced-motion.
(function () {
  "use strict";

  // ---------- directions ----------
  // N=(0,-1) E=(1,0) S=(0,1) W=(-1,0) — used for paths, motion, generation.
  var DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  var DIR_ORDER = ["N", "E", "S", "W"];
  var DIR_NAME = { N: "up", E: "right", S: "down", W: "left" };

  // ============================================================
  // LOGIC — pure functions, no DOM
  // ============================================================

  function key(c, r) { return c + "," + r; }

  function occupancy(arrows) {
    var set = {};
    for (var i = 0; i < arrows.length; i++) {
      var a = arrows[i];
      if (a && a.state !== "REMOVED") set[key(a.c, a.r)] = true;
    }
    return set;
  }

  // Cells strictly ahead of the arrow until the board edge.
  function pathCells(arrow, cols, rows) {
    var d = DIRS[arrow.dir];
    var cells = [];
    var c = arrow.c + d[0];
    var r = arrow.r + d[1];
    while (c >= 0 && r >= 0 && c < cols && r < rows) {
      cells.push([c, r]);
      c += d[0];
      r += d[1];
    }
    return cells;
  }

  // Removable iff zero path cells are occupied (distance is irrelevant).
  function isRemovable(arrow, cols, rows, arrows) {
    if (arrow.state === "REMOVED") return false;
    var occ = occupancy(arrows);
    var path = pathCells(arrow, cols, rows);
    for (var i = 0; i < path.length; i++) {
      if (occ[key(path[i][0], path[i][1])]) return false;
    }
    return true;
  }

  function removableArrows(cols, rows, arrows) {
    var out = [];
    for (var i = 0; i < arrows.length; i++) {
      if (arrows[i].state !== "REMOVED" && isRemovable(arrows[i], cols, rows, arrows)) {
        out.push(arrows[i]);
      }
    }
    return out;
  }

  // Greedy solver: with monotone removals, greedily taking any removable
  // arrow preserves solvability, so this decides solvability exactly.
  function solve(cols, rows, arrows) {
    var live = arrows.filter(function (a) { return a.state !== "REMOVED"; })
      .map(function (a) { return { c: a.c, r: a.r, dir: a.dir }; });
    var remaining = live.length;
    while (remaining > 0) {
      var progressed = false;
      for (var i = 0; i < live.length && !progressed; i++) {
        var a = live[i];
        if (!a) continue;
        if (isRemovable(a, cols, rows, live)) {
          delete live[i];
          remaining--;
          progressed = true;
        }
      }
      if (!progressed) return false; // cannot happen for generated levels
    }
    return true;
  }

  // Reverse-construction generator (the placement order IS a solution):
  // place the last-removed arrow first, then each earlier arrow at a cell
  // whose forward path avoids every placed arrow — biased toward cells on a
  // placed arrow's path, which is what forges dependency chains.
  function generateLevel(cols, rows, count) {
    for (var attempt = 0; attempt < 200; attempt++) {
      var placed = [];
      var occupied = {};
      var ok = true;

      for (var n = 0; n < count && ok; n++) {
        // Placement forges the dependency graph:
        //  60% — extend the ACTIVE chain (place in front of the last-placed
        //        arrow; long single-direction trains result)
        //  20% — start a new chain in front of a random placed arrow
        //  20% — any free cell (independent arrow)
        var pick = null;
        if (placed.length) {
          var roll = Math.random();
          var base = null;
          if (roll < 0.6) base = placed[placed.length - 1];
          else if (roll < 0.8) base = placed[Math.floor(Math.random() * placed.length)];
          if (base) {
            var tc = base.c + DIRS[base.dir][0];
            var tr = base.r + DIRS[base.dir][1];
            if (tc >= 0 && tr >= 0 && tc < cols && tr < rows && !occupied[key(tc, tr)]) {
              pick = { c: tc, r: tr, chained: base.dir };
            }
          }
        }
        if (!pick) {
          var candidates = [];
          for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
              if (!occupied[key(c, r)]) candidates.push({ c: c, r: r });
            }
          }
          if (!candidates.length) { ok = false; break; }
          pick = candidates[Math.floor(Math.random() * candidates.length)];
        }

        // chained placements prefer the blocked arrow's direction (trains),
        // but fall back to any fitting direction instead of failing the board
        var dirs;
        if (pick.chained) {
          dirs = [pick.chained].concat(
            DIR_ORDER.filter(function (d) { return d !== pick.chained; })
              .sort(function () { return Math.random() - 0.5; })
          );
        } else {
          dirs = DIR_ORDER.slice().sort(function () { return Math.random() - 0.5; });
        }
        var done = false;

        for (var di = 0; di < 4 && !done; di++) {
          var dir = dirs[di];
          var path = pathCells({ c: pick.c, r: pick.r, dir: dir }, cols, rows);
          var clear = true;
          for (var p = 0; p < path.length; p++) {
            if (occupied[key(path[p][0], path[p][1])]) { clear = false; break; }
          }
          if (clear) {
            placed.push({ c: pick.c, r: pick.r, dir: dir, state: "AVAILABLE" });
            occupied[key(pick.c, pick.r)] = true;
            done = true;
          }
        }
        if (!done) ok = false; // cell unusable in any direction; retry board
      }
      if (ok && placed.length === count) return placed;
    }
    return null;
  }

  // ============================================================
  // HAND-AUTHORED TEACHING LEVELS (validated by solve() at load)
  // ============================================================

  // L1: one lesson — the front arrow leaves first. A teaches by itself.
  //   → → → .
  function level1() {
    return {
      cols: 4, rows: 1,
      arrows: [
        { c: 0, r: 0, dir: "E" },
        { c: 1, r: 0, dir: "E" },
        { c: 2, r: 0, dir: "E" },
      ],
    };
  }

  // L2: four directions, two chains crossing the middle.
  //   . . ↓ .        column chain: (1,2)→(1,1)→(1,0) then exits top... wait:
  //   ← . . →        left/right arrows exit sideways; down-arrow chain reads
  //   . . . ↓        bottom-up. Verified by solve() at load.
  function level2() {
    return {
      cols: 4, rows: 3,
      arrows: [
        { c: 2, r: 0, dir: "S" },   // blocked by (2,2)
        { c: 0, r: 1, dir: "E" },   // blocked by (3,1)
        { c: 3, r: 1, dir: "E" },   // free → unlocks (0,1)
        { c: 2, r: 2, dir: "S" },   // free → unlocks (2,0)
        { c: 3, r: 2, dir: "W" },   // blocked by (2,2)
      ],
    };
  }

  var AUTHORED = [level1(), level2()];
  var GENERATE_FROM = 2; // levels 3.. build procedurally

  // Difficulty curve: arrows on board, board size grows with level.
  var LEVELS = [
    null, null,
    { cols: 5, rows: 4, count: 8 },
    { cols: 6, rows: 5, count: 12 },
    { cols: 7, rows: 5, count: 16 },
  ];
  var MAX_LEVEL = LEVELS.length; // 5

  // ============================================================
  // STATE
  // ============================================================

  var state = {
    level: 1,
    cols: 0,
    rows: 0,
    arrows: [],
    moves: 0,
    wrong: 0,
    busy: false,   // input lock while an arrow is MOVING
    won: false,
    epoch: 0,      // bumps on restart; in-flight animations check it
  };

  // ---------- DOM ----------
  var boardEl = document.getElementById("board");
  var statusEl = document.getElementById("status");
  var movesEl = document.getElementById("moves");
  var levelEl = document.getElementById("level");
  var restartBtn = document.getElementById("restart");
  var overlayEl = document.getElementById("overlay");
  var overlayTitleEl = document.getElementById("overlay-title");
  var overlaySubEl = document.getElementById("overlay-sub");
  var againBtn = document.getElementById("again");

  if (!boardEl) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ============================================================
  // RENDERING
  // ============================================================

  function pieceTransform(a, exit) {
    var d = DIRS[a.dir];
    var x = a.c * 100;
    var y = a.r * 100;
    if (exit) {
      // travel from current cell to just past the edge
      var steps = exit.dist + 1;
      x += d[0] * steps * 100;
      y += d[1] * steps * 100;
    }
    return "translate(" + x + "%, " + y + "%)";
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    boardEl.style.setProperty("--cols", state.cols);
    boardEl.style.setProperty("--rows", state.rows);
    boardEl.style.setProperty("--cell", cellSize() + "px");

    for (var i = 0; i < state.arrows.length; i++) {
      var a = state.arrows[i];
      var el = document.createElement("button");
      el.type = "button";
      el.className = "piece dir-" + a.dir.toLowerCase();
      el.dataset.id = String(a.id);
      el.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/></svg>';
      el.style.width = "var(--cell)";
      el.style.height = "var(--cell)";
      el.style.transform = pieceTransform(a);
      boardEl.appendChild(el);
      a.el = el;
      paintPiece(a);
    }
  }

  function paintPiece(a) {
    var el = a.el;
    if (!el) return;
    el.classList.toggle("is-removed", a.state === "REMOVED");
    el.classList.toggle("is-blocked", a.state === "BLOCKED");
    el.classList.toggle("is-available", a.state === "AVAILABLE");
    var blocked = a.state === "BLOCKED";
    if (blocked) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
    el.setAttribute("aria-label", describe(a));
  }

  function describe(a) {
    var base = "Row " + (a.r + 1) + ", column " + (a.c + 1) + " — arrow pointing " +
      DIR_NAME[a.dir] + ". ";
    return base + (a.state === "BLOCKED"
      ? "Path blocked. Activate to test."
      : "Path clear. Activate to send it out.");
  }

  function refreshStates() {
    var rem = removableArrows(state.cols, state.rows, state.arrows);
    var remSet = {};
    for (var i = 0; i < rem.length; i++) remSet[rem[i].id] = true;
    for (var j = 0; j < state.arrows.length; j++) {
      var a = state.arrows[j];
      if (a.state === "REMOVED" || a.state === "MOVING") continue;
      a.state = remSet[a.id] ? "AVAILABLE" : "BLOCKED";
      paintPiece(a);
    }
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function updateHud() {
    if (movesEl) movesEl.textContent = String(state.moves);
    if (levelEl) levelEl.textContent = "Level " + String(state.level).padStart(2, "0");
  }

  // ============================================================
  // INTERACTION
  // ============================================================

  function findArrow(id) {
    for (var i = 0; i < state.arrows.length; i++) {
      if (String(state.arrows[i].id) === String(id)) return state.arrows[i];
    }
    return null;
  }

  function onPieceActivate(a) {
    if (state.busy || state.won) return;
    if (a.state === "REMOVED" || a.state === "MOVING") return;

    if (!isRemovable(a, state.cols, state.rows, state.arrows)) {
      blockedFeedback(a);
      return;
    }

    exitArrow(a);
  }

  function blockedFeedback(a) {
    state.wrong++;
    setStatus("Blocked — something is in its way.");
    if (a.el && !reduced) {
      a.el.classList.remove("shake");
      void a.el.offsetWidth;
      a.el.classList.add("shake");
    }
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
  }

  function exitArrow(a) {
    state.busy = true;
    a.state = "MOVING";
    if (a.el) a.el.classList.add("is-moving");
    paintPiece(a);

    var d = DIRS[a.dir];
    var dist = a.dir === "E" ? state.cols - 1 - a.c
      : a.dir === "W" ? a.c
      : a.dir === "S" ? state.rows - 1 - a.r
      : a.r;
    var myEpoch = state.epoch;

    if (reduced) {
      finishExit(a, myEpoch);
      return;
    }

    // distance-scaled duration: fast and satisfying, never slow
    var dur = 280 + dist * 45;
    var el = a.el;
    el.style.transition = "transform " + dur + "ms cubic-bezier(.5,.05,.7,.4), opacity 120ms linear " + (dur - 120) + "ms";
    el.style.transform = pieceTransform(a, { dist: dist });

    var finished = false;
    function onDone() {
      if (finished) return;
      finished = true;
      finishExit(a, myEpoch);
    }
    el.addEventListener("transitionend", onDone, { once: true });
    setTimeout(onDone, dur + 80); // safety net if transitionend is missed
  }

  function finishExit(a, myEpoch) {
    if (myEpoch !== state.epoch) return; // board was reset mid-animation
    a.state = "REMOVED";
    if (a.el) {
      a.el.style.transition = "";
      a.el.style.transform = "";
      a.el.classList.remove("is-moving");
      a.el.classList.add("is-removed");
    }
    state.moves++;
    state.busy = false;

    var left = state.arrows.filter(function (x) { return x.state !== "REMOVED"; }).length;
    if (left === 0) {
      win();
    } else {
      refreshStates();
      updateHud();
      var avail = state.arrows.filter(function (x) { return x.state === "AVAILABLE"; }).length;
      setStatus(avail === 1
        ? "One arrow can leave."
        : avail + " arrows can leave. " + left + " on the board.");
    }
  }

  // ---------- completion ----------

  function win() {
    state.won = true;
    updateHud();
    setStatus("Board clear.");
    if (overlayEl) {
      var last = state.wrong === 0;
      if (overlayTitleEl) overlayTitleEl.textContent = "Level complete";
      if (overlaySubEl) {
        overlaySubEl.textContent = "Board clear in " + state.moves +
          (last ? " — no wasted moves." : " moves.");
      }
      overlayEl.classList.add("show");
    }
  }

  // ---------- level lifecycle ----------

  function cellSize() {
    var vw = Math.min(window.innerWidth || 1024, 700);
    var avail = vw - 92;
    var byRows = 380 / state.rows;
    return Math.max(34, Math.min(62, Math.floor(Math.min(avail / state.cols, byRows))));
  }

  function loadLevel(n) {
    state.level = n;
    state.won = false;
    state.busy = false;
    state.moves = 0;
    state.wrong = 0;
    state.epoch++;

    var layout;
    if (n <= AUTHORED.length) {
      layout = AUTHORED[n - 1];
    } else {
      var spec = LEVELS[n - 1];
      layout = null;
      for (var tries = 0; tries < 200 && !layout; tries++) {
        var arrows = generateLevel(spec.cols, spec.rows, spec.count);
        if (arrows && solve(spec.cols, spec.rows, arrows)) {
          layout = { cols: spec.cols, rows: spec.rows, arrows: arrows };
        }
      }
      if (!layout) layout = AUTHORED[1]; // never ship an unvalidated board
    }

    state.cols = layout.cols;
    state.rows = layout.rows;
    state.arrows = layout.arrows.map(function (a, i) {
      return { id: i + 1, c: a.c, r: a.r, dir: a.dir, state: "AVAILABLE", el: null };
    });

    // authored boards are fixed puzzles — verify, then mark states honestly
    if (!solve(state.cols, state.rows, state.arrows)) {
      // unreachable for shipped constants; guards against future edits
      state.arrows = AUTHORED[0].arrows.map(function (a, i) {
        return { id: i + 1, c: a.c, r: a.r, dir: a.dir, state: "AVAILABLE", el: null };
      });
      state.cols = AUTHORED[0].cols;
      state.rows = AUTHORED[0].rows;
    }

    if (overlayEl) overlayEl.classList.remove("show");
    buildBoard();
    refreshStates();
    updateHud();
    setStatus(n === 1
      ? "Every arrow wants out. Click one whose path is clear."
      : "Clear the board.");
  }

  function restart() {
    loadLevel(state.level);
  }

  function nextLevel() {
    // past the last authored spec, "next" loops the final level with a fresh
    // generated board — the puzzle keeps going
    if (state.level < MAX_LEVEL) loadLevel(state.level + 1);
    else loadLevel(state.level);
  }

  // ---------- events ----------

  boardEl.addEventListener("click", function (e) {
    var el = e.target.closest(".piece");
    if (!el) return;
    var a = findArrow(el.dataset.id);
    if (a) onPieceActivate(a);
  });

  boardEl.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = e.target.closest(".piece");
    if (!el) return;
    e.preventDefault();
    var a = findArrow(el.dataset.id);
    if (a) onPieceActivate(a);
  });

  if (restartBtn) restartBtn.addEventListener("click", restart);
  if (againBtn) againBtn.addEventListener("click", nextLevel);

  // keyboard: R restarts
  document.addEventListener("keydown", function (e) {
    if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey && !e.altKey) restart();
  });

  window.addEventListener("resize", function () {
    boardEl.style.setProperty("--cell", cellSize() + "px");
  });

  // ---------- boot ----------
  // #level-N deep-link (also used for QA): /404.html#level-3
  var hashLevel = parseInt((location.hash.match(/^#level-(\d+)$/) || [])[1], 10);
  loadLevel(hashLevel >= 1 && hashLevel <= MAX_LEVEL ? hashLevel : 1);
})();
