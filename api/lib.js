// Shared helpers for the portfolio API (Vercel serverless, Node runtime).
// Zero dependencies: Node built-ins only.

import crypto from "crypto";

const COOKIE_NAME = "pf_admin";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const MAX_BODY_BYTES = 256 * 1024; // hard cap for content payloads

// ---------- in-memory login throttle (per serverless instance) ----------
// Deliberately simple: it slows brute force; the password itself must still
// be strong. For hardened multi-instance throttling, move to a shared store.
const attempts = new Map(); // ip -> { count, first }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function throttleCheck(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) return { ok: true };
  return rec.count >= MAX_ATTEMPTS
    ? { ok: false, retryAfterMin: Math.ceil((WINDOW_MS - (now - rec.first)) / 60000) }
    : { ok: true };
}

export function throttleRecord(ip, success) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, first: now };
  if (now - rec.first > WINDOW_MS) {
    rec.count = 0;
    rec.first = now;
  }
  rec.count += success ? 0 : 1;
  if (success) rec.count = 0;
  attempts.set(ip, rec);
}

// ---------- session tokens (HMAC-signed, stateless) ----------
function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function createSessionToken() {
  const secret = process.env.SESSION_SECRET;
  const payload = b64url(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS, v: 1 })
  );
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const secret = process.env.SESSION_SECRET;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function verifyPassword(password) {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected || typeof password !== "string" || password.length === 0) return false;
  const a = Buffer.from(password.padEnd(128, "\0").slice(0, 128));
  const b = Buffer.from(expected.padEnd(128, "\0").slice(0, 128));
  return crypto.timingSafeEqual(a, b);
}

// ---------- cookies ----------
export function sessionCookie(token) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  return attrs.join("; ");
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export function isAuthed(req) {
  return verifySessionToken(readSessionCookie(req));
}

// ---------- request body ----------
export function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        resolve(null); // too large
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// ---------- response helpers ----------
export function json(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" ? fwd.split(",")[0] : "") || "unknown";
}

// ---------- content validation ----------
// The editor may only produce this exact shape. Everything is coerced to
// plain strings (browser renders with textContent, never innerHTML).
const ALLOWED_URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
const MAX = {
  strings: 2000,
  paragraphs: 6,
  paragraphLen: 1200,
  projects: 12,
  linksPerProject: 5,
  techPerProject: 12,
  skillGroups: 8,
  skillsPerGroup: 16,
  achievements: 12,
  contactLinks: 6,
};

function safeText(v, fallback = "") {
  if (typeof v !== "string") return fallback;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  return s.slice(0, MAX.strings);
}

function safeLongText(v) {
  return safeText(v).slice(0, MAX.paragraphLen);
}

function safeUrl(v) {
  const s = safeText(v, "");
  if (!s) return "";
  return ALLOWED_URL_RE.test(s) ? s : "";
}

// CTA hrefs may be same-page anchors (#projects) or absolute http(s) URLs —
// nothing else. Blocks javascript:/data:/vbscript: etc.
function safeHref(v) {
  const s = safeText(v, "");
  if (!s) return "";
  return /^#[A-Za-z0-9_-]*$/.test(s) || ALLOWED_URL_RE.test(s) ? s : "";
}

function safeBool(v) {
  return v === true;
}

function safeLinks(arr, max) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, max)
    .map((l) => ({ label: safeText(l?.label, "").slice(0, 40), url: safeUrl(l?.url) }))
    .filter((l) => l.label && l.url);
}

function safeTech(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, MAX.techPerProject)
    .map((t) => safeText(t, "").slice(0, 40))
    .filter(Boolean);
}

function safeVisual(v) {
  return ["evidence", "wiki", "streaks", "recall"].includes(v) ? v : "evidence";
}

export function validateContent(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const out = { version: 1 };

  const hero = input.hero || {};
  out.hero = {
    eyebrow: safeText(hero.eyebrow).slice(0, 120),
    name: safeText(hero.name).slice(0, 80),
    headline: safeText(hero.headline).slice(0, 120),
    sub: safeLongText(hero.sub),
    ctaPrimary: {
      label: safeText(hero.ctaPrimary?.label, "").slice(0, 40) || "View projects",
      href: safeHref(hero.ctaPrimary?.href) || "#projects",
    },
    ctaSecondary: {
      label: safeText(hero.ctaSecondary?.label, "").slice(0, 40) || "Contact me",
      href: safeHref(hero.ctaSecondary?.href) || "#contact",
    },
  };

  const about = input.about || {};
  out.about = {
    heading: safeText(about.heading).slice(0, 160),
    paragraphs: Array.isArray(about.paragraphs)
      ? about.paragraphs.slice(0, MAX.paragraphs).map(safeLongText).filter(Boolean)
      : [],
  };

  const edu = input.education || {};
  out.education = {
    label: safeText(edu.label).slice(0, 60) || "Education",
    lines: Array.isArray(edu.lines)
      ? edu.lines.slice(0, 4).map((l) => safeText(l).slice(0, 120)).filter(Boolean)
      : [],
  };

  out.projects = Array.isArray(input.projects)
    ? input.projects.slice(0, MAX.projects).map((p, i) => ({
        id: safeText(p?.id).slice(0, 40) || `project-${i + 1}`,
        index: safeText(p?.index).slice(0, 4) || String(i + 1).padStart(2, "0"),
        name: safeText(p?.name).slice(0, 80),
        badge: safeText(p?.badge).slice(0, 60),
        flagship: safeBool(p?.flagship),
        visible: p?.visible !== false,
        whatItIs: safeLongText(p?.whatItIs),
        whyItExists: safeLongText(p?.whyItExists),
        howItWorks: safeLongText(p?.howItWorks),
        tech: safeTech(p?.tech),
        links: safeLinks(p?.links, MAX.linksPerProject),
        demoNote: safeLongText(p?.demoNote),
        visual: safeVisual(p?.visual),
        visualCaption: safeText(p?.visualCaption).slice(0, 120),
      }))
    : [];

  const skills = input.skills || {};
  out.skills = {
    heading: safeText(skills.heading).slice(0, 160),
    note: safeText(skills.note).slice(0, 240),
    groups: Array.isArray(skills.groups)
      ? skills.groups.slice(0, MAX.skillGroups).map((g) => ({
          label: safeText(g?.label).slice(0, 60),
          items: Array.isArray(g?.items)
            ? g.items.slice(0, MAX.skillsPerGroup).map((s) => safeText(s).slice(0, 60)).filter(Boolean)
            : [],
        }))
      : [],
  };

  out.achievements = Array.isArray(input.achievements)
    ? input.achievements.slice(0, MAX.achievements).map((a, i) => ({
        id: safeText(a?.id).slice(0, 40) || `achievement-${i + 1}`,
        year: safeText(a?.year).slice(0, 10),
        title: safeText(a?.title).slice(0, 120),
        description: safeLongText(a?.description),
        linkLabel: safeText(a?.linkLabel).slice(0, 40),
        linkUrl: safeUrl(a?.linkUrl),
        visible: a?.visible !== false,
      }))
    : [];

  const contact = input.contact || {};
  out.contact = {
    heading: safeText(contact.heading).slice(0, 160),
    lede: safeLongText(contact.lede),
    email: safeText(contact.email).slice(0, 120),
    links: safeLinks(contact.links, MAX.contactLinks),
  };

  const seo = input.seo || {};
  out.seo = {
    title: safeText(seo.title).slice(0, 120),
    description: safeText(seo.description).slice(0, 300),
    socialTitle: safeText(seo.socialTitle).slice(0, 120),
    socialDescription: safeText(seo.socialDescription).slice(0, 300),
  };

  // structural sanity floor: an all-empty object ("{}" or hollow shell) is a
  // malformed save and is rejected; intentional empties (e.g. achievements: [])
  // with real content elsewhere are legitimate and must be stored as-is.
  // Per-field emptiness is the admin's prerogative (Issue 1, case B).
  if (out.hero.name.length === 0 && out.projects.length === 0) return null;

  return out;
}
