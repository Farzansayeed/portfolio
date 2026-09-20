// Orb field — the real "thinking orbs" engine rendered as a hero background.
//
// Engine: github.com/kubo-vision/thinking-orbs v0.3.1, MIT © Jakub Antalik,
// vendored verbatim as orb-engine.js (framework-free canvas code). The
// package ships a React wrapper; this file is a faithful vanilla port of its
// runtime shell: resolvePreset(state, size) → { mode, speed, opts }, then
// MODE_DRAWS[mode](ctx, size, t, isDark, opts) per frame — same guards as the
// wrapper (IntersectionObserver, visibilitychange, reduced-motion static
// frame), same tuned 64px preset, dark ink.
//
// One state only (a portfolio has no status semantics): "working" —
// particles on tilted orbits, the package's default state. Each orb is
// clipped to its own square and drawn additively so the field blends into
// the wave-field behind it.
//
// Guards: pauses off-screen and on hidden tabs, DPR capped at 1.5, fewer
// orbs on mobile, static frame under prefers-reduced-motion.
import {
  MODE_DRAWS,
  resolvePreset,
} from "./orb-engine.js";

(function () {
  "use strict";

  var canvas = document.getElementById("hero-orbs");
  if (!canvas || canvas.dataset.orbBound) return;
  canvas.dataset.orbBound = "1";

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mobile = window.matchMedia("(max-width: 640px)").matches;

  // ---- field tuning: few, small, slow — an accent over the wave ----
  var ORBS = mobile ? 6 : 11;
  var SPEED = 0.6; // calmer than the chat-avatar default
  var INK = 0.85;

  var preset = resolvePreset("working", 64);
  var draw = MODE_DRAWS[preset.mode];

  var layout = [];
  var W = 0, H = 0, dpr = 1;
  var raf = 0, running = false, visible = true;
  var last = 0;

  function rnd(i, salt) {
    // deterministic per-orb pseudo-random so resize keeps the same field
    var x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function buildLayout() {
    layout = [];
    for (var i = 0; i < ORBS; i++) {
      // lower ~55% of the hero, three loose columns, away from the headline
      var col = i % 3;
      var row = Math.floor(i / 3);
      layout.push({
        x: 0.16 + col * 0.34 + (rnd(i, 1) - 0.5) * 0.22,
        y: 0.54 + row * 0.13 + (rnd(i, 2) - 0.5) * 0.08,
        size: i < 2 ? 64 : Math.round(64 * (0.62 + rnd(i, 3) * 0.3)),
        phase: rnd(i, 4) * Math.PI * 2,
        speedJit: 0.75 + rnd(i, 5) * 0.5,
        depth: 0.65 + rnd(i, 6) * 0.35, // smaller orbs read farther away
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    buildLayout();
  }

  function drawAll(tNow) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < layout.length; i++) {
      var o = layout[i];
      var s = o.size;
      // slow independent drift per orb
      var x = o.x * W - s / 2 + Math.sin(tNow * 0.05 * o.speedJit + o.phase) * 16 * o.depth;
      var y = o.y * H - s / 2 + Math.cos(tNow * 0.04 * o.speedJit + o.phase * 2) * 12 * o.depth;
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.rect(0, 0, s, s);
      ctx.clip();
      ctx.globalAlpha = INK * o.depth;
      // the engine paints at the origin, so translate first, then clip
      draw(ctx, s, tNow * SPEED * o.speedJit + o.phase, true, preset.opts);
      ctx.restore();
    }
  }

  function frame(now) {
    if (!running) return;
    var tNow = last ? last + Math.min(48, now - last) : now;
    last = now;
    drawAll(tNow / 1000);
    raf = requestAnimationFrame(frame);
  }

  function staticFrame() {
    // one calm frame under prefers-reduced-motion
    drawAll(600);
  }

  function start() {
    if (running || !visible) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onVisible(entries) {
    visible = entries[0].isIntersecting;
    if (visible && !reduced) start();
    else stop();
  }

  resize();
  window.addEventListener("resize", function () {
    resize();
    if (reduced) staticFrame();
  });

  if (reduced) {
    staticFrame();
  } else {
    new IntersectionObserver(onVisible).observe(canvas);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else if (visible) start();
    });
    start();
  }
})();
