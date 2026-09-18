// GET /api/content  — public: returns centrally stored content JSON.
//                   If no store is configured or the store errors, returns
//                   null content so the site falls back to bundled defaults.
// PUT /api/content  — authenticated write. Validates strictly before storing.
//
// Supports both Vercel store models:
//  • Classic Edge Config:   EDGE_CONFIG_ID + EDGE_CONFIG_READ_WRITE_TOKEN
//  • New "Global Config":   GLOBAL_CONFIG connection-string descriptor
//                           (auto-injected by "Connect to Project"; embeds
//                           id + a read token at global-config.vercel.com)
// Writes go through the model's write path when a read-write credential
// exists; otherwise the write fails loudly (503) instead of silently.

import { isAuthed, readJsonBody, validateContent, json } from "./lib.js";

const CLASSIC_ID = process.env.EDGE_CONFIG_ID;
const CLASSIC_TOKEN = process.env.EDGE_CONFIG_READ_WRITE_TOKEN;
const GC_DESCRIPTOR = process.env.GLOBAL_CONFIG; // https://global-config.vercel.com/ecfg_...?token=...
const GC_BASE = process.env.EDGE_CONFIG_API || "https://global-config.vercel.com";
const CLASSIC_BASE = process.env.EDGE_CONFIG_API_CLASSIC || "https://api.vercel.com";
// Writes: Global Config store tokens are read-only, so saves go through
// Vercel's authenticated REST API with an account-scoped API token instead.
const API_TOKEN = process.env.VERCEL_API_TOKEN;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

function gcInfo() {
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

async function fetchT(url, opts = {}, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- reads ----------

async function gcRead(info) {
  if (!info) return null;
  try {
    const res = await fetchT(`${GC_BASE}/${info.id}?token=${info.readToken}`);
    if (!res.ok) return null;
    const data = await res.json();
    const items = data && data.items;
    return items && typeof items.portfolio_content === "object"
      ? items.portfolio_content
      : null;
  } catch {
    return null;
  }
}

async function classicRead() {
  if (!CLASSIC_ID) return null;
  try {
    const res = await fetchT(
      `${CLASSIC_BASE}/v1/edge-config/${CLASSIC_ID}/items?slug=portfolio_content`,
      { headers: CLASSIC_TOKEN ? { Authorization: `Bearer ${CLASSIC_TOKEN}` } : {} }
    );
    if (!res.ok) return null;
    const items = await res.json();
    const item = items.find((i) => i.key === "portfolio_content");
    return item && typeof item.value === "object" ? item.value : null;
  } catch {
    return null;
  }
}

// ---------- writes ----------

async function gcWrite(info, content) {
  // Global Config model: PATCH the items batch endpoint via Vercel's REST API
  // (account token). Store-level tokens are read-only by design.
  if (!API_TOKEN) return false;
  const res = await fetchT(
    `https://api.vercel.com/v1/global-config/${info.id}/items` +
      (TEAM_ID ? `?teamId=${TEAM_ID}` : ""),
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: "portfolio_content", value: content }],
      }),
    },
    8000
  );
  return res.ok;
}

async function classicWrite(content) {
  const res = await fetchT(
    `${CLASSIC_BASE}/v1/edge-config/${CLASSIC_ID}/items/portfolio_content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CLASSIC_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: "portfolio_content", value: content }],
      }),
    },
    8000
  );
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    let content = null;
    let source = "fallback";
    try {
      content = (await gcRead(gcInfo())) || (await classicRead());
      if (content) source = "edge";
    } catch {
      content = null;
    }
    // content: null tells the client to use its bundled defaults.
    return json(res, 200, { ok: true, source, content });
  }

  if (req.method === "PUT") {
    if (!isAuthed(req)) {
      return json(res, 401, { ok: false, error: "Unauthorized." });
    }
    const gc = gcInfo();
    const hasStore = !!(gc || CLASSIC_ID);
    const hasWriteCred = !!(API_TOKEN || CLASSIC_TOKEN);
    if (!hasStore) {
      return json(res, 503, {
        ok: false,
        error:
          "Content store not configured. Connect the Edge Config store to this project.",
      });
    }

    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      return json(res, 400, { ok: false, error: "Invalid request body." });
    }

    const clean = validateContent(body.content ?? body);
    if (!clean) {
      return json(res, 400, { ok: false, error: "Invalid content structure." });
    }

    // Edge Config free tier caps a store at 8 KB — fail explicitly, not mysteriously
    if (JSON.stringify(clean).length > 8000) {
      return json(res, 413, {
        ok: false,
        error:
          "Content too large for the content store (8 KB limit). Trim long text fields.",
      });
    }

    let stored = false;
    try {
      stored = gc ? await gcWrite(gc, clean) : await classicWrite(clean);
    } catch {
      stored = false;
    }
    if (!stored) {
      return json(
        res,
        502,
        {
          ok: false,
          error: hasWriteCred
            ? "Could not persist content. Try again."
            : "Content saving is not configured. Add VERCEL_API_TOKEN (and VERCEL_TEAM_ID) as project environment variables — see README “Private content editing”.",
        },
        { "Retry-After": "2" }
      );
    }

    return json(res, 200, { ok: true, savedAt: new Date().toISOString(), content: clean });
  }

  return json(res, 405, { ok: false, error: "Method not allowed." });
}
