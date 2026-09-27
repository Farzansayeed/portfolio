// POST /api/github-webhook — receives GitHub App / account webhook deliveries.
//
// Security: the raw body is read (bounded) BEFORE any parsing, and the
// X-Hub-Signature-256 HMAC-SHA256 signature is verified against
// GITHUB_WEBHOOK_SECRET. Unsigned/invalid requests are rejected with 401
// before the payload is even parsed. The delivery id (X-GitHub-Delivery) is
// used as a per-instance replay guard for repeated deliveries.
//
// Events: `repository` (created/public/edited/archived/privatized/unarchived…)
// and `push` — the two that matter for opt-in imports. Every accepted,
// signature-valid event is acknowledged 200 (even when the pipeline records
// an error): GitHub retries on 4xx/5xx/timeouts, so a 200 + recorded status
// lets the admin Retry button — not webhook spam — drive retries.

import {
  verifyWebhookSignature,
  readRawBody,
  parseWebhookBody,
  handleRepositoryEvent,
  handlePushEvent,
} from "./lib-import.js";
import { json } from "./lib.js";

const replay = new Map(); // delivery id -> processed epoch ms
const REPLAY_TTL_MS = 10 * 60 * 1000;

function seenRecently(id, now = Date.now()) {
  if (!id) return false;
  // prune
  for (const [k, t] of replay) {
    if (now - t > REPLAY_TTL_MS) replay.delete(k);
  }
  const last = replay.get(id);
  if (last && now - last < REPLAY_TTL_MS) return true;
  replay.set(id, now);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed." });
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return json(res, 503, {
      ok: false,
      error: "Webhook secret not configured (GITHUB_WEBHOOK_SECRET).",
    });
  }

  const raw = await readRawBody(req);
  if (!raw) {
    return json(res, 413, { ok: false, error: "Payload too large or unreadable." });
  }

  const sig = req.headers["x-hub-signature-256"];
  if (!verifyWebhookSignature(raw, typeof sig === "string" ? sig : "", secret)) {
    return json(res, 401, { ok: false, error: "Invalid signature." });
  }

  const event = String(req.headers["x-github-event"] || "");
  if (event !== "repository" && event !== "push") {
    // Subscribed-but-unhandled event types are acknowledged, not errors.
    return json(res, 200, { ok: true, handled: false, event });
  }

  const delivery = typeof req.headers["x-github-delivery"] === "string" ? req.headers["x-github-delivery"] : "";
  if (seenRecently(delivery)) {
    return json(res, 200, { ok: true, duplicate: true });
  }

  const payload = parseWebhookBody(raw, req.headers["content-type"]);
  if (!payload || typeof payload !== "object") {
    return json(res, 400, { ok: false, error: "Invalid payload." });
  }

  const repoPayload =
    event === "push"
      ? payload.repository
      : event === "repository"
        ? payload.repository || null
        : null;

  if (!repoPayload || !repoPayload.owner || !repoPayload.name) {
    return json(res, 200, { ok: true, handled: false, reason: "no repository in payload" });
  }

  let result;
  try {
    result =
      event === "push"
        ? await handlePushEvent(repoPayload)
        : await handleRepositoryEvent(repoPayload);
  } catch (e) {
    console.error("webhook pipeline error:", e && (e.message || String(e)));
    return json(res, 200, { ok: false, error: "pipeline error recorded" });
  }

  if (result && result.ok) {
    return json(res, 200, { ok: true, action: result.action });
  }
  // Storage/pipeline failures are recorded in the admin view; acknowledge so
  // GitHub does not hot-retry a failing store.
  console.error("webhook pipeline failure:", result && result.reason);
  return json(res, 200, { ok: false, error: "recorded" });
}
