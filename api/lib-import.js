// Imported-projects store + GitHub import pipeline. Zero dependencies.
//
// Storage: the import store is the committed file `portfolio/imports.json`
// in this repository (shape: { version: 1, projects: [entry, ...] }), read
// fresh through the GitHub API on every pipeline run and written back with a
// single commit. This keeps imported state visible and auditable in git and
// completely independent of the Edge Config store that holds curated content
// (whose 8 KB free-tier budget curated content already nearly fills — a
// shared store refused every import write).
//
// entry: { key, repoId, owner, repo, htmlUrl, importedAt, lastAttemptAt,
//          status, published, trigger, confidence?, category?, featured?,
//          lastError?, project? }
//   status: "published" | "held" | "pending" | "error" | "unpublished" | "duplicate"
//   key: normalized GitHub URL (the stable unique id); repoId kept as backup.
//
// Writes require GITHUB_TOKEN with `repo` scope (Contents: write on the
// portfolio repo). Reads work without a token (public repo, lower limits).
// Each write triggers Vercel's auto-deploy (~60-120s) before the public site
// shows the change; the admin panel reads state through the same file.

import crypto from "crypto";
import { aiConfigured, callAI } from "./lib-ai.js";

const OWNER = (process.env.GITHUB_IMPORT_OWNER || "Farzansayeed").trim();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
// The repo that hosts the import store (the portfolio repo itself).
const STORE_REPO = (process.env.IMPORT_STORE_REPO || "portfolio").trim();
const STORE_BRANCH = (process.env.IMPORT_STORE_BRANCH || "main").trim();
const STORE_PATH = (process.env.IMPORT_STORE_PATH || "portfolio/imports.json").trim();
const MAX_IMPORTS = 12;
const MAX_WEBHOOK_BODY = 512 * 1024;
const README_CAP = 32000;
const PUSH_COOLDOWN_MS = 60 * 1000;

// Function-level limits for slow AI providers (NVIDIA NIM queueing can take
// 40-90s per call). Vercel Hobby caps serverless functions at 60s by default;
// maxDuration raises the ceiling up to the plan limit (60 on Hobby).
export const maxDuration = 60;

// Edge Config access — mirrors api/content.js (Global Config + classic).
const GC_DESCRIPTOR = process.env.GLOBAL_CONFIG;
const GC_BASE = process.env.EDGE_CONFIG_API || "https://global-config.vercel.com";
const GC_WRITE_BASE = process.env.EDGE_CONFIG_API_WRITE || "https://api.vercel.com";
const CLASSIC_ID = process.env.EDGE_CONFIG_ID;
const CLASSIC_TOKEN = process.env.EDGE_CONFIG_READ_WRITE_TOKEN;
const CLASSIC_BASE = process.env.EDGE_CONFIG_API_CLASSIC || "https://api.vercel.com";
const API_TOKEN = process.env.VERCEL_API_TOKEN;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

const pushCooldown = new Map(); // "owner/repo" -> last processed epoch ms

// ---------- tiny helpers ----------

export function gcInfo() {
  if (!GC_DESCRIPTOR) return null;
  try {
    const url = new URL(GC_DESCRIPTOR);
    const id = url.pathname.split("/").pop();
    const readToken = url.searchParams.get("token");
    if (!id || !id.startsWith("ecfg_")) return null;
    return { id, readToken };
  } catch {
    return null;
  }
}

async function fetchT(url, opts = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function cleanStr(v, cap) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, cap);
}

function safeHttpsUrl(v) {
  const s = cleanStr(v, 300);
  return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : "";
}

// ---------- webhook signature + body ----------

export function verifyWebhookSignature(rawBuf, header, secret) {
  if (!rawBuf || !secret || typeof header !== "string") return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBuf).digest("hex");
  const a = Buffer.from(m[1].toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function readRawBody(req, maxBytes = MAX_WEBHOOK_BODY) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

// GitHub sends JSON or form-encoded (payload=<urlencoded json>).
export function parseWebhookBody(rawBuf, contentType) {
  if (!rawBuf) return null;
  const raw = rawBuf.toString("utf8");
  const ct = String(contentType || "").toLowerCase();
  try {
    if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const payload = params.get("payload");
      return payload ? JSON.parse(payload) : null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------- eligibility (pure) ----------

export function normalizeRepoKey(url) {
  const s = cleanStr(url, 300).replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(s);
  return m ? `https://github.com/${m[1].toLowerCase()}/${m[2].toLowerCase()}` : "";
}

export function isEligible(repo) {
  if (!repo || typeof repo !== "object") return false;
  const owner = repo.owner && repo.owner.login;
  if (!owner || owner.toLowerCase() !== OWNER.toLowerCase()) return false;
  if (repo.private === true || repo.fork === true || repo.archived === true || repo.disabled === true) return false;
  const topics = Array.isArray(repo.topics) ? repo.topics : [];
  return topics.some((t) => String(t).toLowerCase() === "portfolio");
}

export function ownerMatches(repo) {
  const owner = repo && repo.owner && repo.owner.login;
  return Boolean(owner) && owner.toLowerCase() === OWNER.toLowerCase();
}

// ---------- store access ----------

export function emptyStore() {
  return { version: 1, projects: [] };
}

export function validateStoreShape(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return emptyStore();
  const projects = Array.isArray(x.projects)
    ? x.projects.filter(
        (e) =>
          e && typeof e === "object" && typeof e.key === "string" && e.key &&
          typeof e.status === "string"
      )
    : [];
  return { version: 1, projects: projects.slice(0, MAX_IMPORTS + 8) };
}

// ---------- Edge Config read (curated content only — for dedupe) ----------

async function storeReadKey(key) {
  const gc = gcInfo();
  if (gc) {
    try {
      const res = await fetchT(`${GC_BASE}/${gc.id}?token=${gc.readToken}`);
      if (res.ok) {
        const data = await res.json();
        const items = data && data.items;
        if (items && typeof items[key] !== "undefined") return items[key];
        return null;
      }
    } catch {
      /* fall through to classic */
    }
  }
  if (CLASSIC_ID) {
    try {
      const res = await fetchT(
        `${CLASSIC_BASE}/v1/edge-config/${CLASSIC_ID}/items?slug=${key}`,
        { headers: CLASSIC_TOKEN ? { Authorization: `Bearer ${CLASSIC_TOKEN}` } : {} }
      );
      if (res.ok) {
        const items = await res.json();
        const item = Array.isArray(items) ? items.find((i) => i.key === key) : null;
        return item && typeof item.value !== "undefined" ? item.value : null;
      }
    } catch {
      /* unreadable */
    }
  }
  return null;
}

// ---------- store: portfolio/imports.json in this GitHub repo ----------

function ghStoreHeaders(extra) {
  const h = { "User-Agent": "portfolio-import", ...(extra || {}) };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

async function ghStoreJson(path) {
  try {
    const res = await fetchT(`https://api.github.com${path}`, { headers: ghStoreHeaders({ Accept: "application/vnd.github+json" }) }, 8000);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, json: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
}

// Read the committed import store. Fresh on every call — no caching — so the
// admin view always reflects the latest committed state.
async function readImportStoreRaw() {
  const r = await ghStoreJson(`/repos/${OWNER}/${STORE_REPO}/contents/${STORE_PATH}?ref=${encodeURIComponent(STORE_BRANCH)}`);
  if (r.ok && r.json && typeof r.json.content === "string") {
    try {
      return { store: validateStoreShape(JSON.parse(Buffer.from(r.json.content, "base64").toString("utf8"))), sha: r.json.sha || null };
    } catch {
      return { store: emptyStore(), sha: r.json.sha || null };
    }
  }
  if (r.status === 404) return { store: emptyStore(), sha: null }; // first run: file does not exist yet
  return { store: null, sha: null, error: r.status === 403 ? "GitHub rate limit while reading the import store." : `GitHub API ${r.status || " unreachable"} while reading the import store.` };
}

// Commit the store back. Uses the Contents API: GET gives the current sha,
// PUT upserts. 422 with "does not exist" handling covers the first-write race.
async function writeImportStoreRaw(store) {
  if (!GITHUB_TOKEN) {
    return { ok: false, reason: "GITHUB_TOKEN not configured — cannot commit the import store." };
  }
  const body = JSON.stringify(store, null, 2) + "\n";
  const content = Buffer.from(body, "utf8").toString("base64");

  let sha = null;
  const cur = await ghStoreJson(`/repos/${OWNER}/${STORE_REPO}/contents/${STORE_PATH}?ref=${encodeURIComponent(STORE_BRANCH)}`);
  if (cur.ok && cur.json && cur.json.sha) sha = cur.json.sha;
  else if (!cur.ok && cur.status !== 404) {
    return { ok: false, reason: cur.error || `Could not read the import store before writing (GitHub ${cur.status}).` };
  }

  const put = await fetchT(
    `https://api.github.com/repos/${OWNER}/${STORE_REPO}/contents/${STORE_PATH}`,
    {
      method: "PUT",
      headers: ghStoreHeaders({ Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: `imports: update imported-projects store (${store.projects.length} entr${store.projects.length === 1 ? "y" : "ies"})`,
        content,
        branch: STORE_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    },
    12000
  ).then(async (res) => ({ status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) }));

  if (put.ok) return { ok: true };
  const msg = put.body && put.body.message ? String(put.body.message).slice(0, 160) : `GitHub API ${put.status}`;
  return { ok: false, reason: `Could not commit the import store: ${msg}` };
}

export async function readStore(io) {
  if (io && io.readStore) return validateStoreShape(await io.readStore());
  const raw = await readImportStoreRaw();
  return raw.store === null ? emptyStore() : raw.store;
}

// Commit the store to the repo. Small on purpose (bounded entries, short
// texts); a pathological store is refused rather than committed.
export async function writeStore(store, io) {
  if (io && io.writeStore) {
    const ok = await io.writeStore(store);
    return ok ? { ok: true } : { ok: false, reason: "Could not persist the import store." };
  }
  const json = JSON.stringify(store);
  if (json.length > 64 * 1024) {
    return { ok: false, reason: "Import store implausibly large — refusing to commit." };
  }
  return writeImportStoreRaw(store);
}

// ---------- GitHub reads (bounded, untrusted content) ----------

function ghHeaders(accept) {
  const h = {
    Accept: accept || "application/vnd.github+json",
    "User-Agent": "portfolio-import",
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

async function ghJson(path) {
  try {
    const res = await fetchT(`https://api.github.com${path}`, { headers: ghHeaders() }, 6000);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, json: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function ghText(url, accept, cap) {
  try {
    const res = await fetchT(url, { headers: ghHeaders(accept) }, 6000);
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, cap);
  } catch {
    return "";
  }
}

// Collects bounded material for the AI: metadata, README, languages, a few
// manifests, and the optional trusted meta file. Everything is treated as
// untrusted data by the adapter.
async function fetchMaterial(repo) {
  const owner = repo.owner.login;
  const name = repo.name;
  const branch = repo.default_branch || "main";
  const metaFile = await ghText(
    `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(branch)}/.portfolio.json`,
    "application/json",
    2048
  );
  let meta = null;
  if (metaFile) {
    try {
      const j = JSON.parse(metaFile);
      if (j && typeof j === "object" && !Array.isArray(j)) {
        meta = {
          liveUrl: safeHttpsUrl(j.liveUrl),
          category: ["web", "tool", "ai", "game"].includes(j.category) ? j.category : null,
          featured: j.featured === true,
          note: cleanStr(j.note, 200),
        };
      }
    } catch {
      meta = null; // malformed meta file is simply ignored
    }
  }
  const metaFileText = meta ? metaFile.slice(0, 600) : "";

  const manifestNames = ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"];
  const manifestPromises = manifestNames.map((f) =>
    ghText(
      `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(branch)}/${f}`,
      "text/plain",
      4096
    ).then((t) => ({ f, t }))
  );
  const readmePromise = ghText(
    `https://api.github.com/repos/${owner}/${name}/readme`,
    "application/vnd.github.raw+json",
    README_CAP
  );
  const languagesPromise = ghJson(`/repos/${owner}/${name}/languages`);

  const [readme, languagesRes, ...manifests] = await Promise.all([readmePromise, languagesPromise, ...manifestPromises]);

  let languages = "";
  if (languagesRes.ok && languagesRes.json && typeof languagesRes.json === "object") {
    const entries = Object.entries(languagesRes.json)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const total = entries.reduce((s, e) => s + e[1], 0) || 1;
    languages = entries.map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join(", ");
  }

  const manifestText = manifests
    .filter((m) => m.t)
    .slice(0, 2)
    .map((m) => `--- ${m.f} ---\n${m.t}`)
    .join("\n\n")
    .slice(0, 1800);

  return {
    owner,
    repo: name,
    repoId: repo.id,
    sha: cleanStr(repo.pushed_at, 40) || "0",
    description: cleanStr(repo.description, 400),
    language: cleanStr(repo.language, 60),
    languages,
    topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 10).join(", ") : "",
    homepage: safeHttpsUrl(repo.homepage),
    meta,
    metaFile: metaFileText,
    readme,
    manifests: manifestText,
    htmlUrl: normalizeRepoKey(repo.html_url),
  };
}

// Trusted live-demo sources only: the repo's own .portfolio.json meta file and
// the repository homepage setting. The AI's liveUrl is accepted only when it
// matches one of these (it can never mint a new URL).
function trustedLiveUrl(material) {
  return material.meta && material.meta.liveUrl ? material.meta.liveUrl : material.homepage || "";
}

// ---------- curated dedupe ----------

// Curated dedupe reads the Edge Config store (curated content still lives
// there) via the same read path api/content.js uses.
async function readCuratedRepoKeys() {
  const keys = new Set();
  try {
    const curated = await storeReadKey("portfolio_content");
    if (curated && Array.isArray(curated.projects)) {
      for (const p of curated.projects) {
        for (const l of Array.isArray(p.links) ? p.links : []) {
          const k = normalizeRepoKey(l && l.url);
          if (k) keys.add(k);
        }
      }
    }
  } catch {
    /* store unreadable — client-side dedupe still applies */
  }
  return keys;
}

// ---------- entry construction (pure) ----------

export function buildEntryFromDraft(material, draft) {
  const name = cleanStr(draft.title, 60);
  const description = cleanStr(draft.description, 240);
  if (!name || !description) return null;
  const tech = (Array.isArray(draft.tech) ? draft.tech : [])
    .map((t) => cleanStr(t, 28))
    .filter(Boolean)
    .slice(0, 6);
  const links = [{ label: "Source", url: material.htmlUrl }];
  const live = trustedLiveUrl(material);
  if (live) links.push({ label: "Live", url: live });
  // Empty fields are omitted — the public renderer hides absent rows, and the
  // store stays small.
  const project = {
    id: "import-" + String(material.repo || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
    name,
    badge: "Imported from GitHub",
    flagship: false,
    visible: true,
    whatItIs: description,
    tech,
    links,
  };
  return project;
}

function upsertEntry(store, entry) {
  const i = store.projects.findIndex((e) => e.key === entry.key);
  if (i >= 0) store.projects[i] = entry;
  else store.projects.push(entry);
}

function entryKeyByRepoId(store, repoId) {
  return store.projects.find((e) => String(e.repoId) === String(repoId));
}

// ---------- the pipeline ----------

// Processes one repository end to end: eligibility → material → AI → validated
// entry → upsert. Idempotent: re-running with the same repo state produces the
// same single entry (keyed by GitHub URL).
export async function processRepository(opts) {
  const { owner, repo, trigger = "manual", io = null } = opts;
  const store = await readStore(io);

  const meta = await ghJson(`/repos/${owner}/${repo}`);
  const now = new Date().toISOString();

  if (!meta.ok) {
    if (meta.status === 404) {
      const existing =
        store.projects.find((e) => e.owner.toLowerCase() === String(owner).toLowerCase() &&
          e.repo.toLowerCase() === String(repo).toLowerCase()) ||
        store.projects.find((e) => e.key === normalizeRepoKey(`https://github.com/${owner}/${repo}`));
      if (existing) {
        existing.published = false;
        existing.status = "unpublished";
        existing.lastAttemptAt = now;
        existing.lastError = "Repository not accessible (private or deleted) — card unpublished.";
        const w = await writeStore(store, io);
        return w.ok ? { ok: true, action: "unpublished" } : { ok: false, reason: w.reason };
      }
      return { ok: true, action: "skipped", reason: "Repository not found." };
    }
    return { ok: false, reason: meta.status === 403 ? "GitHub API rate limit — try again later." : "GitHub API unreachable." };
  }

  const r = meta.json;
  if (!isEligible(r)) {
    const existing = entryKeyByRepoId(store, r.id) || store.projects.find((e) => e.key === normalizeRepoKey(r.html_url));
    if (existing) {
      existing.published = false;
      existing.status = "unpublished";
      existing.lastAttemptAt = now;
      existing.lastError = "Not eligible (missing `portfolio` topic, or not public/owner repo) — card unpublished.";
      const w = await writeStore(store, io);
      return w.ok ? { ok: true, action: "unpublished" } : { ok: false, reason: w.reason };
    }
    return { ok: true, action: "skipped", reason: "Not eligible (owner, topic, public, non-fork, non-archived)." };
  }

  const key = normalizeRepoKey(r.html_url);

  // Renames: re-key the old entry so no orphan remains.
  const byId = entryKeyByRepoId(store, r.id);
  if (byId && byId.key !== key) {
    byId.key = key;
    byId.repo = r.name;
    byId.htmlUrl = r.html_url;
  }

  // Manual curation wins: if a curated entry already links this repo, record
  // the duplicate and never publish a second card.
  const curatedKeys = await readCuratedRepoKeys();
  if (curatedKeys.has(key)) {
    const existing = store.projects.find((e) => e.key === key) || byId;
    const entry = existing || {
      key,
      repoId: r.id,
      owner: r.owner.login,
      repo: r.name,
      htmlUrl: r.html_url,
      importedAt: now,
      trigger,
    };
    entry.repoId = r.id;
    entry.owner = r.owner.login;
    entry.repo = r.name;
    entry.htmlUrl = r.html_url;
    entry.lastAttemptAt = now;
    entry.status = "duplicate";
    entry.published = false;
    entry.lastError = "This repository is already covered by a manually curated project — curated entry kept.";
    delete entry.project;
    upsertEntry(store, entry);
    const w = await writeStore(store, io);
    return w.ok ? { ok: true, action: "duplicate" } : { ok: false, reason: w.reason };
  }

  if (!aiConfigured()) {
    const existing = store.projects.find((e) => e.key === key) || byId;
    const entry = existing || {
      key,
      repoId: r.id,
      owner: r.owner.login,
      repo: r.name,
      htmlUrl: r.html_url,
      importedAt: now,
      trigger,
    };
    entry.repoId = r.id;
    entry.owner = r.owner.login;
    entry.repo = r.name;
    entry.htmlUrl = r.html_url;
    entry.lastAttemptAt = now;
    entry.lastError = "AI not configured (AI_API_KEY / AI_BASE_URL / AI_MODEL) — nothing drafted.";
    if (!entry.project) {
      entry.status = "error";
      entry.published = false;
    }
    upsertEntry(store, entry);
    const w = await writeStore(store, io);
    return w.ok ? { ok: true, action: "recorded", status: entry.status } : { ok: false, reason: w.reason };
  }

  const material = await fetchMaterial(r);
  const ai = await callAI(material);
  const existing = store.projects.find((e) => e.key === key) || byId;

  if (!ai.ok || ai.draft.rejected) {
    const reason = ai.draft && ai.draft.rejected
      ? `AI declined: ${((ai.draft.errors || []).join(" | ") || "material not recognizable as a software project").slice(0, 200)}.`
      : ai.reason || "AI draft failed.";
    if (existing && existing.project) {
      // Preserve the last good card; just record the failed attempt.
      existing.lastAttemptAt = now;
      existing.lastError = reason;
      upsertEntry(store, existing);
      const w = await writeStore(store, io);
      return w.ok ? { ok: true, action: "kept" } : { ok: false, reason: w.reason };
    }
    const entry = existing || {
      key,
      repoId: r.id,
      owner: r.owner.login,
      repo: r.name,
      htmlUrl: r.html_url,
      importedAt: now,
      trigger,
    };
    entry.repoId = r.id;
    entry.owner = r.owner.login;
    entry.repo = r.name;
    entry.htmlUrl = r.html_url;
    entry.lastAttemptAt = now;
    entry.status = "error";
    entry.published = false;
    entry.lastError = reason;
    delete entry.project;
    upsertEntry(store, entry);
    const w = await writeStore(store, io);
    return w.ok ? { ok: true, action: "error" } : { ok: false, reason: w.reason };
  }

  const project = buildEntryFromDraft(material, ai.draft);
  if (!project) {
    if (existing && existing.project) {
      existing.lastAttemptAt = now;
      existing.lastError = "AI draft failed validation — previous card kept.";
      upsertEntry(store, existing);
      const w = await writeStore(store, io);
      return w.ok ? { ok: true, action: "kept" } : { ok: false, reason: w.reason };
    }
    return { ok: false, reason: "AI draft failed validation." };
  }

  const published = ai.draft.confidence !== "low"; // low confidence → held for review
  const entry = existing || {
    key,
    repoId: r.id,
    owner: r.owner.login,
    repo: r.name,
    htmlUrl: r.html_url,
    importedAt: now,
    trigger,
  };
  entry.repoId = r.id;
  entry.owner = r.owner.login;
  entry.repo = r.name;
  entry.htmlUrl = r.html_url;
  entry.lastAttemptAt = now;
  entry.status = published ? "published" : "held";
  entry.published = published && entry.status !== "held";
  entry.trigger = trigger;
  entry.confidence = ai.draft.confidence;
  entry.category = ai.draft.category || (material.meta && material.meta.category) || undefined;
  entry.featured = ai.draft.featured || (material.meta && material.meta.featured) || false;
  entry.project = project;
  delete entry.lastError;
  upsertEntry(store, entry);

  // Slot cap: prefer dropping oldest error/unpublished entries, else refuse.
  while (store.projects.length > MAX_IMPORTS) {
    const droppable =
      store.projects.find((e) => e.key !== key && e.status === "error") ||
      store.projects.find((e) => e.key !== key && !e.published);
    if (!droppable) {
      store.projects.splice(store.projects.indexOf(entry), 1);
      return { ok: false, reason: `Import store full (${MAX_IMPORTS} entries) — remove one in the admin editor.` };
    }
    store.projects.splice(store.projects.indexOf(droppable), 1);
  }

  const w = await writeStore(store, io);
  if (!w.ok) return { ok: false, reason: w.reason };
  return { ok: true, action: published ? "published" : "held", status: entry.status };
}

// Push events carry a `commits` array — a repo whose head commit added its
// README/topic is exactly the "created before it was ready" case the queue
// handles: the delivery marks the repo pending/queued and the next live
// request processes it. Cooldown guards against push storms.
export async function queuePushEvent(repoPayload, io = null) {
  if (!ownerMatches(repoPayload)) return { ok: true, action: "skipped", reason: "owner" };
  const k = `${repoPayload.owner.login}/${repoPayload.name}`.toLowerCase();
  const now = Date.now();
  const last = pushCooldown.get(k) || 0;
  if (now - last < PUSH_COOLDOWN_MS) return { ok: true, action: "skipped", reason: "cooldown" };
  pushCooldown.set(k, now);

  const store = await readStore(io);
  const key = normalizeRepoKey(repoPayload.html_url);
  const tracked = store.projects.some((e) => e.key === key || String(e.repoId) === String(repoPayload.id));
  if (!tracked && !isEligible(repoPayload)) return { ok: true, action: "skipped", reason: "not eligible" };
  if (repoPayload.deleted === true) {
    // push to a deleted ref — nothing to do
    return { ok: true, action: "skipped", reason: "deleted ref" };
  }
  return recordWebhookPending(repoPayload, "push", io);
}

// Repository events: eligibility policy lives in recordWebhookPending (it
// unpublishes ineligible-but-tracked repos instead of queueing them).
export async function queueRepositoryEvent(repoPayload, io = null) {
  if (!ownerMatches(repoPayload)) return { ok: true, action: "skipped", reason: "owner" };
  if (!repoPayload.name || !repoPayload.owner) return { ok: true, action: "skipped", reason: "malformed" };
  return recordWebhookPending(repoPayload, "webhook", io);
}

// Webhook fast path: record the delivery as a 'pending' row (or a refresh
// marker for already-imported repos) and return. The platform freezes
// serverless functions after the response, so the slow AI work cannot run
// after res.end() — instead, subsequent live requests drain the queue inside
// their own request window via drainPending().
export async function recordWebhookPending(repoPayload, trigger = "webhook", io = null) {
  if (!ownerMatches(repoPayload) || !repoPayload.name || !repoPayload.owner) {
    return { ok: true, action: "skipped", reason: "owner" };
  }
  const store = await readStore(io);
  const key = normalizeRepoKey(repoPayload.html_url || `https://github.com/${repoPayload.owner.login}/${repoPayload.name}`);
  const existing = store.projects.find((e) => e.key === key || String(e.repoId) === String(repoPayload.id));

  // Ineligible delivery (topic removed / privatized / archived / fork):
  // unpublish a tracked card immediately; never queue anything new.
  if (!isEligible(repoPayload)) {
    if (existing) {
      existing.published = false;
      existing.status = "unpublished";
      existing.lastAttemptAt = new Date().toISOString();
      existing.lastError = "Not eligible (missing `portfolio` topic, or not public/owner repo) — card unpublished.";
      delete existing.refreshQueued;
      const w = await writeStore(store, io);
      return w.ok ? { ok: true, action: "unpublished" } : { ok: false, reason: w.reason };
    }
    return { ok: true, action: "skipped", reason: "not eligible" };
  }

  const now = new Date().toISOString();

  // Already imported: queue a refresh. The live card stays visible until the
  // drain replaces (or preserves) it.
  if (existing && existing.project && existing.status !== "pending") {
    if (existing.refreshQueued) return { ok: true, action: "already-queued" };
    existing.refreshQueued = true;
    const w = await writeStore(store, io);
    return w.ok ? { ok: true, action: "queued" } : { ok: false, reason: w.reason };
  }

  if (existing && existing.status === "pending") {
    return { ok: true, action: "already-pending" };
  }

  const entry = existing || {
    key,
    repoId: repoPayload.id,
    owner: repoPayload.owner.login,
    repo: repoPayload.name,
    htmlUrl: repoPayload.html_url || key,
    importedAt: now,
    trigger,
  };
  entry.repoId = repoPayload.id;
  entry.owner = repoPayload.owner.login;
  entry.repo = repoPayload.name;
  entry.htmlUrl = repoPayload.html_url || key;
  entry.lastAttemptAt = now;
  entry.status = "pending";
  entry.published = entry.published === true;
  entry.lastError = "Queued by webhook — processing on the next site visit or admin check.";
  if (existing) Object.assign(existing, entry);
  else store.projects.push(entry);
  const w = await writeStore(store, io);
  return w.ok ? { ok: true, action: "pending" } : { ok: false, reason: w.reason };
}

// Per-instance in-flight lock: concurrent requests never process the same
// job twice on one instance. Cross-instance duplicates are possible but rare
// on a personal site, and the AI memo/backoff maps bound the cost.
const draining = new Set();

// Called from live request contexts (GET /api/imports): synchronously process
// up to `limit` pending/refresh jobs inside the caller's request window.
// Cheap when the queue is empty (the single store read the caller needs
// anyway). Returns the (fresh) store so the caller can serve from it.
export async function drainPending(limit = 1, io = null) {
  const store = await readStore(io);
  const jobs = store.projects
    .filter((e) => e.status === "pending" || e.refreshQueued === true)
    .filter((e) => !draining.has(e.key))
    .slice(0, limit);
  if (!jobs.length) return { processed: 0, results: [], store };

  const results = [];
  for (const job of jobs) {
    draining.add(job.key);
    try {
      const r = await processRepository({ owner: job.owner, repo: job.repo, trigger: job.trigger || "webhook", io });
      results.push({ repo: job.repo, action: r.action || (r.ok ? "done" : "failed"), reason: r.reason || null });
    } catch (e) {
      results.push({ repo: job.repo, action: "failed", reason: String((e && e.message) || e).slice(0, 120) });
    } finally {
      draining.delete(job.key);
    }
  }

  // Clear refresh markers (processRepository does not know about them).
  let changed = false;
  const fresh = await readStore(io);
  for (const e of fresh.projects) {
    if (e.refreshQueued && !draining.has(e.key) && e.status !== "pending") {
      delete e.refreshQueued;
      changed = true;
    }
  }
  if (changed) await writeStore(fresh, io);
  return { processed: results.length, results, store: fresh };
}

// ---------- public projection ----------

export function publicEntries(store) {
  return store.projects
    .filter((e) => e.published === true && e.status === "published" && e.project)
    .map((e) => ({ key: e.key, htmlUrl: e.htmlUrl, importedAt: e.importedAt, project: e.project }));
}

// Entries with neither a drafted project nor a final verdict are transient:
// "pending" rows from an in-flight webhook, or stale "pending" rows whose
// background continuation died. The admin Retry button revives either.
export function isTransient(entry) {
  return entry.status === "pending" && !entry.project;
}

// ---------- diagnostics (admin-only, no secrets in the report) ----------

// Probes each dependency the pipeline needs — store read, store write,
// GitHub API, AI provider — and reports timing/status per leg. Values returned
// are booleans, timings, and short reasons only; never keys or tokens.
export async function diagnoseImports() {
  const out = { owner: OWNER, store: {}, github: {}, ai: {} };

  const t0 = Date.now();
  try {
    const raw = await readImportStoreRaw();
    out.store.read = raw.store === null
      ? { ok: false, reason: raw.error || "unreadable", ms: Date.now() - t0 }
      : { ok: true, entries: raw.store.projects.length, ms: Date.now() - t0 };
  } catch (e) {
    out.store.read = { ok: false, reason: String((e && e.message) || e).slice(0, 120) };
  }

  const t1 = Date.now();
  try {
    const raw = await readImportStoreRaw();
    const w = await writeStore(raw.store); // no-op rewrite of the current state
    out.store.write = { ok: w.ok, reason: w.reason || null, ms: Date.now() - t1 };
  } catch (e) {
    out.store.write = { ok: false, reason: String((e && e.message) || e).slice(0, 120) };
  }

  const t2 = Date.now();
  try {
    const gh = await ghJson(`/repos/${OWNER}/portfolio`);
    out.github = {
      ok: gh.ok,
      status: gh.status,
      authenticated: Boolean(GITHUB_TOKEN),
      ms: Date.now() - t2,
      note: gh.ok ? null : gh.status === 403 ? "rate limited — add/refresh GITHUB_TOKEN" : "GitHub API unreachable",
    };
  } catch (e) {
    out.github = { ok: false, reason: String((e && e.message) || e).slice(0, 120) };
  }

  const t3 = Date.now();
  try {
    const ai = await callAI({
      owner: OWNER,
      repo: "diagnostic-probe",
      repoId: 0,
      sha: "probe",
      description: "Diagnostic connectivity probe for the import pipeline.",
      language: "",
      languages: "",
      topics: "",
      homepage: "",
      meta: null,
      metaFile: "",
      readme: "This is a connectivity probe. Answer with the JSON shape requested.",
      manifests: "",
      htmlUrl: `https://github.com/${OWNER}/diagnostic-probe`,
    });
    out.ai = {
      ok: ai.ok,
      reason: ai.reason || null,
      cached: Boolean(ai.cached),
      draftOk: Boolean(ai.draft && !ai.draft.rejected),
      ms: Date.now() - t3,
      configured: aiConfigured(),
    };
  } catch (e) {
    out.ai = { ok: false, configured: aiConfigured(), reason: String((e && e.message) || e).slice(0, 120) };
  }

  return out;
}

export function ownerName() {
  return OWNER;
}
