// GET /api/content  — public: returns centrally stored content JSON.
//                   If no store is configured or the store errors, returns
//                   null content so the site falls back to bundled defaults.
// PUT /api/content  — authenticated write. Validates strictly before storing.

import { isAuthed, readJsonBody, validateContent, json } from "./lib.js";

const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;
const EDGE_CONFIG_TOKEN = process.env.EDGE_CONFIG_READ_WRITE_TOKEN;
// Base URL overridable for local testing against a mock store.
const EDGE_API_BASE = process.env.EDGE_CONFIG_API || "https://api.vercel.com";
const EDGE_API = (id, slug) =>
  `${EDGE_API_BASE}/v1/edge-config/${id}/items${slug ? "/" + slug : ""}`;

async function edgeGet() {
  if (!EDGE_CONFIG_ID || !EDGE_CONFIG_TOKEN) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000); // fail fast to fallback
  try {
    const res = await fetch(EDGE_API(EDGE_CONFIG_ID) + "?slug=portfolio_content", {
      headers: { Authorization: `Bearer ${EDGE_CONFIG_TOKEN}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const items = await res.json();
    const item = items.find((i) => i.key === "portfolio_content");
    return item && typeof item.value === "object" ? item.value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function edgePut(content) {
  const res = await fetch(EDGE_API(EDGE_CONFIG_ID, "portfolio_content"), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${EDGE_CONFIG_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ operation: "upsert", key: "portfolio_content", value: content }],
    }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    let content = null;
    let source = "fallback";
    try {
      content = await edgeGet();
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
    if (!EDGE_CONFIG_ID || !EDGE_CONFIG_TOKEN) {
      return json(res, 503, {
        ok: false,
        error:
          "Content store not configured. Set EDGE_CONFIG_ID and EDGE_CONFIG_READ_WRITE_TOKEN.",
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
        error: "Content too large for the content store (8 KB limit). Trim long text fields.",
      });
    }

    let stored = false;
    try {
      stored = await edgePut(clean);
    } catch {
      stored = false;
    }
    if (!stored) {
      return json(res, 502, { ok: false, error: "Could not persist content. Try again." });
    }

    return json(res, 200, { ok: true, savedAt: new Date().toISOString(), content: clean });
  }

  return json(res, 405, { ok: false, error: "Method not allowed." });
}
