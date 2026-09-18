// POST /api/auth — login (rate-limited), DELETE — logout.
// Zero dependencies. Password lives only in the ADMIN_PASSWORD env var.

import {
  throttleCheck,
  throttleRecord,
  verifyPassword,
  createSessionToken,
  sessionCookie,
  clearCookie,
  readJsonBody,
  json,
  clientIp,
  isAuthed,
} from "./lib.js";

export default async function handler(req, res) {
  const ip = clientIp(req);

  if (req.method === "POST") {
    const gate = throttleCheck(ip);
    if (!gate.ok) {
      return json(res, 429, { ok: false, error: "Too many attempts. Try again later." });
    }

    const body = await readJsonBody(req, 1024); // login body is tiny
    const password = typeof body?.password === "string" ? body.password : "";
    const ok = verifyPassword(password);
    throttleRecord(ip, ok);

    if (!ok) {
      return json(res, 401, { ok: false, error: "Incorrect password." });
    }

    const token = createSessionToken();
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token) });
  }

  if (req.method === "DELETE") {
    return json(res, 200, { ok: true }, { "Set-Cookie": clearCookie() });
  }

  if (req.method === "GET") {
    // session probe for the editor — read-only, no side effects
    return json(res, isAuthed(req) ? 200 : 401, { ok: isAuthed(req) });
  }

  return json(res, 405, { ok: false, error: "Method not allowed." });
}
