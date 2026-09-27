# Automatic GitHub imports — setup guide

Add the topic `portfolio` to a public repo on your account and, once the steps
below are done, this site drafts and publishes a project card for it
automatically. No code edits, no redeploy.

Everything below happens server-side. No secret ever reaches the browser, the
repo, or this documentation — placeholders only.

---

## 1. How imports are triggered (the topic workflow)

1. Open the repository's page on GitHub.
2. In the right sidebar, click the **gear icon ⚙ beside "About"**.
3. Under **Topics**, type `portfolio` and press Enter.
4. Click **Save changes**.

Eligibility rules enforced server-side on every event:

- Repository owner must be **`Farzansayeed`** (case-insensitive) — override with the `GITHUB_IMPORT_OWNER` env var.
- The repo must be **public**, **not a fork**, **not archived**, and carry the topic **`portfolio`**.
- Anything else is ignored (or, if it was already imported, its card is unpublished automatically).

Removing the topic, archiving, or making the repo private unpublishes the
imported card (it stays visible in the admin editor with a recorded reason —
nothing is silently deleted). Re-adding the topic publishes it again on the
next relevant event or admin **Retry**.

---

## 2. Create and install the GitHub App (one-time)

A minimal account-scoped GitHub App gives event-driven imports — no polling.

1. GitHub → Settings → **Developer settings → GitHub Apps → New GitHub App**.
2. Fill in:
   - **GitHub App name:** e.g. `farzan-portfolio-importer`
   - **Homepage URL:** `https://portfolio-farzan4.vercel.app`
   - **Webhook ✓ Active** → **Webhook URL:**
     `https://portfolio-farzan4.vercel.app/api/github-webhook`
   - **Webhook secret:** generate one, e.g. `openssl rand -hex 32` — this exact
     value goes into the Vercel env var `GITHUB_WEBHOOK_SECRET` (step 3). Use a
     placeholder here first if you prefer; the endpoint rejects unsigned
     deliveries either way.
   - **Permissions → Repository permissions:**
     - **Metadata** → **Read-only** (mandatory; this is what carries topics)
     - **Contents** → **Read-only** (README + manifests)
   - Nothing else. No write permissions anywhere.
   - **Subscribe to events:** **Repositories** and **Push** — only these two.
   - **Where can this app be installed:** **Any account** (you will install it only on yours).
3. **Create GitHub App**. On the app's page, generate a **private key** only if
   you later want installation-token auth; the basic flow here uses none —
   repository reads go through the public API (optionally authenticated with a
   classic `GITHUB_TOKEN` to raise rate limits, see step 3).
4. **Install the App**: app page → **Install** → **Only select repositories**
   (pick the repos you may want to import) or **All repositories**. Installing
   it on your account is what makes your repositories' events flow to the webhook.

> Why an App and not polling: GitHub delivers `repository` events (created,
> edited, made public, archived, privatized, renamed…) and `push` events within
> seconds, and a repo created without a README or topic is simply ignored until
> the event that makes it eligible. No cron, no plan limits, no missed updates.

---

## 3. Configure Vercel environment variables

Project → Settings → **Environment Variables** (Production). All of these are
server-side only. **Restart/redeploy after changing them.**

| Variable | Required? | Value |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | **required** for the webhook | The webhook secret from step 2 (never commit it) |
| `GITHUB_IMPORT_OWNER` | optional | Defaults to `Farzansayeed` |
| `GITHUB_TOKEN` | optional | A classic PAT with **public repo read** scope only — raises GitHub API rate limits; never needed for the feature to work |
| `AI_API_KEY` | for AI drafting | API key for your GLM provider account (runtime API access — a chat/coding subscription is not the same thing) |
| `AI_BASE_URL` | for AI drafting | Provider base URL, e.g. `https://api.zhipuai.example/v1` style OpenAI-compatible endpoint (check your provider's docs for the exact URL) |
| `AI_MODEL` | for AI drafting | Model id, e.g. the GLM 5.3 Flash model name your provider documents |

Existing vars that imports reuse: `GLOBAL_CONFIG` (auto-injected by the Edge
Config connection), `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` (store writes), plus
the admin auth vars. If the editor can already save content, imports can
already persist.

**Without `AI_*` vars:** events are still accepted; each eligible repo gets an
entry in the admin Imports list with status `error` and the reason "AI not
configured". Nothing is published, nothing breaks. Add the three vars later and
press **Retry import**.

---

## 4. Deploy and verify

1. Push the branch with this feature to `main` (Vercel auto-deploys).
2. **Webhook ping:** after the App is created/installed, GitHub sends a `ping`
   event. The endpoint replies `200 {"ok":true,"handled":false}` for it —
   the App page's **Recent Deliveries** list should show the green `200`.
3. **End-to-end:** add the topic `portfolio` to a small public repo (gear
   beside About → Topics → `portfolio` → Save). Within seconds a
   `repository` event should appear in Recent Deliveries with `200`.
4. Open the site — the new card appears in the projects section after the
   imported entries load (they hydrate after curated content), and
   `/admin/` → **Imports (GitHub)** shows the repo with status, last sync
   time, and its drafted card.

---

## 5. Publish now or review first?

**High/medium-confidence drafts publish immediately.** That is the point of
the feature — add a topic, get a card, no manual step.

**Low-confidence drafts are held for review** (status `held`, not on the public
site). Open `/admin/` → Imports (GitHub) → check the drafted card → **Publish**
or **Retry**. You can also **Hide** any published import without deleting it.

Publishing is conservative by design: the AI can only fill title, a short
factual description, evidence-backed tech, and the GitHub URL. A live-demo link
appears only from the repo's **homepage setting** or an optional
`.portfolio.json` file in the repo root:

```json
{ "liveUrl": "https://your-demo.example.com", "category": "web", "featured": true, "note": "shown to the AI as trusted context" }
```

The AI never invents users, metrics, dates, awards, or outcomes — empty fields
are omitted, not guessed. If the repository is already covered by a manually
curated card (its GitHub URL appears in the curated project's links), the
import is marked `duplicate` and the curated entry stands.

---

## 6. Troubleshooting

| Symptom | Where to look | Fix |
|---|---|---|
| No delivery appears in Recent Deliveries | GitHub App page | App not installed on the account, or wrong webhook URL |
| Delivery shows non-200 | App page → Recent Deliveries → response body | `401` → `GITHUB_WEBHOOK_SECRET` mismatch between GitHub and Vercel. `503` → env var missing entirely. `413` → oversized payload (not expected) |
| Delivery `200` but no card | `/admin/` → Imports (GitHub) | The entry records the reason: `AI not configured`, `duplicate`, `Not eligible`, store-budget message, etc. Fix and press **Retry import** |
| Entry says AI error repeatedly | Vercel function logs for `/api/github-webhook` | Check `AI_BASE_URL` (must be the OpenAI-compatible base, no trailing `/chat/completions`), `AI_MODEL`, key validity. Failures back off 5 minutes per repo to protect cost |
| Store write errors | Vercel env vars | `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` must be present (same as editor saves) |
| Nothing in admin at all | — | No eligible repo has produced an event yet. Do the topic workflow again and watch Recent Deliveries |

**Manual retry:** `/admin/` → Imports (GitHub) → **Retry import** re-runs the
whole pipeline for that repo (fresh GitHub reads, fresh AI draft if
configured) and updates the same entry in place — imports are keyed by the
repository's GitHub URL, so retries never create duplicates.

**Limits worth knowing:** imports cap at 4 published/held entries and the
import store keeps a small budget of the shared Edge Config store (8 KB free
tier); over-budget writes are refused with a clear recorded reason instead of
corrupting your curated content. README handling is bounded (truncated), and
per-repo push events are debounced to at most one pipeline run per minute.

---

## 7. Security notes

- Signature check happens on the **raw body** before parsing; unsigned or
  malformed requests are rejected with `401`/`400` and never touch the store.
- README/AI content is untrusted: the AI prompt fences repo material as inert
  data, its JSON reply is strictly validated (string caps, URL allow-list,
  markup stripped), and everything renders via `textContent` — no HTML from
  repos or the AI ever reaches the page.
- Secrets live only in Vercel env vars. They appear nowhere in HTML, JS,
  logs, error responses, or the admin view (the Imports panel shows status
  text only).
- The GitHub App needs only **Metadata: read** + **Contents: read** and the
  two events above. Revoke it any time from GitHub → Developer settings.
