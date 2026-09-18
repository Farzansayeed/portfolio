// Hero scene — a slow-breathing wave field of points with mouse parallax.
// Monochrome points, one warm sand accent band. Pauses when the hero leaves
// the viewport or the tab is hidden. Static CSS fallback when WebGL is
// unavailable; disabled entirely under prefers-reduced-motion.
import * as THREE from "three";

const canvas = document.getElementById("hero-canvas");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function webglAvailable() {
  try {
    const test = document.createElement("canvas");
    return !!(window.WebGLRenderingContext &&
      (test.getContext("webgl2") || test.getContext("webgl")));
  } catch {
    return false;
  }
}

if (canvas && !reducedMotion && webglAvailable()) {
  try {
    init();
  } catch (err) {
    fallback();
  }
} else {
  fallback();
}

function fallback() {
  // static dotted field via CSS gradient — no animation, no JS
  if (canvas) canvas.remove();
  const hero = document.querySelector(".hero");
  if (hero && !hero.querySelector(".hero-fallback")) {
    const div = document.createElement("div");
    div.className = "hero-fallback";
    div.setAttribute("aria-hidden", "true");
    hero.appendChild(div);
  }
}

function init() {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b0a08, 0.05);

  const camera = new THREE.PerspectiveCamera(
    52,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 4.6, 9.5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // points don't benefit enough to justify the cost
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  // ---- Wave field ----
  const COLS = isMobile ? 90 : 130;
  const ROWS = isMobile ? 42 : 60;
  const GAP = 0.42;
  const count = COLS * ROWS; // 3,780 mobile / 7,800 desktop points

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  const base = new THREE.Color(0x8a8a94); // cool grey
  const accent = new THREE.Color(0xd3a95c); // warm sand
  const c = new THREE.Color();

  let i = 0;
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      const px = (x - (COLS - 1) / 2) * GAP;
      const pz = (z - (ROWS - 1) / 2) * GAP;
      positions[i * 3] = px;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = pz;

      // mostly grey; one soft band of accent sweeping through
      const band = Math.exp(-Math.pow((z / ROWS) * 1.6 - 0.62, 2) * 14);
      const jitter = 0.06 * Math.random();
      c.copy(base).lerp(accent, Math.min(band * 0.85 + jitter, 1));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      seeds[i] = Math.random() * Math.PI * 2;
      i++;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.028,
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  // ---- Interaction state ----
  const mouse = { x: 0, y: 0 };
  const ease = { x: 0, y: 0 };
  let inView = true;
  let tabVisible = true;
  let rafId = 0;

  window.addEventListener(
    "pointermove",
    (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true }
  );

  const io = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
    },
    { threshold: 0 }
  );
  io.observe(canvas);

  document.addEventListener("visibilitychange", () => {
    tabVisible = !document.hidden;
  });

  const onResize = () => {
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  };
  window.addEventListener("resize", onResize);

  // ---- Scan sweep ----
  // A slow band of brighter points traverses the field — the register
  // being read. Ties the hero to the portfolio's core idea: extraction
  // with evidence. Pure per-frame color work, no extra geometry.
  const SCAN_PERIOD = 14; // seconds per full pass
  const baseColors = colors.slice(); // untouched base color buffer
  const colAttr = geometry.getAttribute("color");
  const scan = new THREE.Color(0xe6c483);

  // ---- Loop ----
  const posAttr = geometry.getAttribute("position");
  const clock = new THREE.Clock();

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!inView || !tabVisible) return; // idle: skip work, RAF stays cheap

    const t = clock.elapsedTime;
    ease.x += (mouse.x - ease.x) * 0.045;
    ease.y += (mouse.y - ease.y) * 0.045;

    for (let j = 0; j < count; j++) {
      const px = posAttr.getX(j);
      const pz = posAttr.getZ(j);
      posAttr.setY(
        j,
        Math.sin(px * 0.35 + t * 0.55 + seeds[j]) * 0.16 +
          Math.sin(pz * 0.5 - t * 0.4) * 0.22 +
          Math.sin((px + pz) * 0.22 + t * 0.22) * 0.3
      );
    }
    posAttr.needsUpdate = true;

    // scan band: brightness boost near the sweeping column; points outside
    // it are restored to base so no trail is left behind
    const fieldW = (COLS - 1) * GAP;
    const scanX = ((t / SCAN_PERIOD) % 1) * (fieldW + 8) - fieldW / 2 - 4;
    for (let j = 0; j < count; j++) {
      const d = Math.abs(posAttr.getX(j) - scanX);
      if (d < 2.4) {
        const boost = Math.exp(-(d * d) * 1.4) * 0.55;
        colAttr.setXYZ(
          j,
          baseColors[j * 3] + (scan.r - baseColors[j * 3]) * boost,
          baseColors[j * 3 + 1] + (scan.g - baseColors[j * 3 + 1]) * boost,
          baseColors[j * 3 + 2] + (scan.b - baseColors[j * 3 + 2]) * boost
        );
      } else {
        colAttr.setXYZ(
          j,
          baseColors[j * 3],
          baseColors[j * 3 + 1],
          baseColors[j * 3 + 2]
        );
      }
    }
    colAttr.needsUpdate = true;

    points.rotation.y = t * 0.02 + ease.x * 0.09;
    camera.position.x = ease.x * 0.7;
    camera.position.y = 4.6 - ease.y * 0.45;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  frame();
  canvas.classList.add("ready"); // fades the canvas in via CSS
}
