// /api/imports — public read of published imported projects + admin management.
//
//   GET (public)                     → { ok, entries: [...] }  published cards only
//   GET ?view=admin                  → authenticated: full import state (no secrets)
//   POST { action: "retry",  key }   → authenticated: re-run the import pipeline
//   POST { action: "remove", key }   → authenticated: delete the imported entry
//   POST { action: "publish", key }  → authenticated: publish a held entry
//   POST { action: "hide",   key }   → authenticated: unpublish (keep) an entry
//
// All admin actions reuse the same HMAC session cookie as the content editor
// (isAuthed from api/lib.js). No secrets are ever returned by any branch.

import { isAuthed, readJsonBody, json } from "./lib.js";
import {
  readStore,
  writeStore,
  publicEntries,
  processRepository,
} from "./lib-import.js";

export { maxDuration } from "./lib-import.js"; // admin retry can call slow AI

function keyFromQuery(req) {
  try {
    return new URL(req.url, "http://x").searchParams.get("key") || "";
  } catch {
    return "";
  }
}

function findEntry(store, key) {
  return store.projects.find((e) => e && e.key === key);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const isAdminView = new URL(req.url, "http://x").searchParams.get("view") === "admin";
    if (isAdminView) {
      if (!isAuthed(req)) return json(res, 401, { ok: false, error: "Unauthorized." });
      const store = await readStore();
      return json(res, 200, { ok: true, admin: true, entries: store.projects });
    }
    const store = await readStore();
    return json(res, 200, { ok: true, entries: publicEntries(store) });
  }

  if (req.method === "POST") {
    if (!isAuthed(req)) return json(res, 401, { ok: false, error: "Unauthorized." });
    const body = await readJsonBody(req, 4096);
    const action = body && body.action;
    const key = body && typeof body.key === "string" ? body.key : "";

    if (action === "retry") {
      const store = await readStore();
      const entry = findEntry(store, key);
      if (!entry) return json(res, 404, { ok: false, error: "Import not found." });
      const result = await processRepository({ owner: entry.owner, repo: entry.repo, trigger: "manual" });
      if (!result.ok) return json(res, 502, { ok: false, error: result.reason || "Import failed." });
      return json(res, 200, { ok: true, action: result.action, status: result.status });
    }

    if (action === "remove") {
      const store = await readStore();
      const i = store.projects.findIndex((e) => e && e.key === key);
      if (i === -1) return json(res, 404, { ok: false, error: "Import not found." });
      store.projects.splice(i, 1);
      const w = await writeStore(store);
      if (!w.ok) return json(res, 502, { ok: false, error: w.reason || "Could not persist." });
      return json(res, 200, { ok: true, removed: key });
    }

    if (action === "publish" || action === "hide") {
      const store = await readStore();
      const entry = findEntry(store, key);
      if (!entry) return json(res, 404, { ok: false, error: "Import not found." });
      if (!entry.project) {
        return json(res, 409, { ok: false, error: "No drafted project to publish — retry the import first." });
      }
      entry.published = action === "publish";
      entry.status = action === "publish" ? "published" : "unpublished";
      delete entry.lastError;
      const w = await writeStore(store);
      if (!w.ok) return json(res, 502, { ok: false, error: w.reason || "Could not persist." });
      return json(res, 200, { ok: true, key, status: entry.status });
    }

    return json(res, 400, { ok: false, error: "Unknown action." });
  }

  return json(res, 405, { ok: false, error: "Method not allowed." });
}
