# Farzan Sayeed Hashmi — Portfolio

Single-page developer portfolio. Hand-written HTML, CSS, and JavaScript with a Three.js wave-field hero — no framework, no npm/build dependencies. External resources are two CDN loads (Inter font, Three.js module) and nothing else.

**Live:** https://portfolio-farzan4.vercel.app

## Stack

| Layer | Choice |
|---|---|
| Structure | Semantic HTML5 |
| Styling | Hand-written CSS (design tokens in `:root` of `portfolio/styles.css`) |
| Behavior | Vanilla JS (`portfolio/main.js`) |
| Hero visual | Three.js r160 via CDN ESM import (`portfolio/three-hero.js`) |

**Dependency note:** "no dependencies" above means no npm packages, no build step, no framework. The page does load two external resources from CDNs (the Inter font and the Three.js module). Keep the importmap pinned — it is the only Three.js reference.

## Local development

No install step. Serve the `portfolio/` folder (module imports then behave exactly like production):

```bash
cd portfolio
python -m http.server 8000
# then open http://localhost:8000
```

## File structure

```
portfolio/             — the website itself (Vercel serves this folder)
  index.html           — structure + bundled fallback content
  styles.css           — design system + all section styles (tokens at the top)
  main.js              — nav state, mobile menu, scroll reveals, email copy, hidden editor trigger
  three-hero.js        — Three.js wave-field hero
  content.client.js    — hydrates saved content over the fallback (public, ~4 KB)
  content.default.json — bundled fallback content (= what ships in the HTML)
  shots/               — project screenshots (placeholder images until real captures replace them)
  resume.pdf           — résumé download (placeholder until the real PDF replaces it)
  make_placeholders.py — regenerates the placeholder shots + resume.pdf
  admin/               — private editor (login + forms; noindex)
  favicon.svg
  og.png               — social share image (generated)
  make_og.py           — regenerates og.png (Pillow; run from inside portfolio/)
api/                   — serverless functions (Vercel)
  auth.js              — POST login (rate-limited) / DELETE logout
  content.js           — GET public content, PUT authenticated write
  lib.js               — HMAC sessions, throttle, strict content validator
vercel.json            — outputDirectory, noindex header for /admin, no-store for /api
```

## Private content editing

### How to access the hidden admin

There is no visible admin link anywhere on the site. To open the editor:

> **Click the sand-colored dot in "Farzan S. Hashmi." in the top navigation 5 times within 3 seconds.**

The page silently navigates to `/admin/` — a plain login screen. On mobile, tap the same dot (left of the nav) 5 times quickly.

### Passwords

| Environment | Password | Where it lives |
|---|---|---|
| **Production** (deployed site) | `Farzan-Portfolio-2029!edit` | Vercel env var `ADMIN_PASSWORD` (server-side only — it appears nowhere in shipped JS/HTML) |

> ⚠️ **If this repository is ever made public, change the production password first** (`vercel env add ADMIN_PASSWORD production`, enter the new value, then redeploy). The hidden trigger is convenience only — all editing requires the password server-side; discovering `/admin/` or the trigger grants nothing.

### Setup (once, at deploy)

1. Create an Edge Config store in the Vercel dashboard (**Storage → portfolio-content**)
2. **Connect it to the project** (Storage → portfolio-content → Connect) — this injects the `GLOBAL_CONFIG` connection variable used for public reads
3. Editor **saves** go through Vercel's REST API using an account-scoped API token (store-level tokens are read-only by design):
   - vercel.com → avatar → **Account Settings → Tokens → Add** — no project scope, optional expiry — paste it as the project env var `VERCEL_API_TOKEN` (Production)
   - also set `VERCEL_TEAM_ID` (team id from the Vercel URL / `vercel teams ls`)
   - store the token server-side only; revoke it from the same settings page anytime
4. Environment variables for the project:
   - `ADMIN_PASSWORD` — your editor password (long, unique)
   - `SESSION_SECRET` — long random string (e.g. `openssl rand -hex 24`)
   - `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` — from step 3
5. Redeploy. Open `/admin/`, sign in, edit, **Save changes** — content is stored centrally and served to every visitor. No redeploy needed for content changes.

**Fallback behavior:** `portfolio/content.default.json` is the site's baseline. If the store is unconfigured or errors, visitors silently get the bundled content — the site never breaks. To keep the bundled fallback in sync with centrally saved content: after a save, open `https://<your-domain>/api/content`, copy the `content` object into `portfolio/content.default.json`, and include the change in your next code deploy (crawl-time SEO reads the HTML, which ships this file).

**Security model:** password only in env vars; HMAC-signed HttpOnly SameSite=Lax Secure session cookie (14 days); in-memory login throttle (5 fails / 15 min / serverless instance — best-effort on cold starts, so also add a Vercel Firewall rate rule on `POST /api/auth` for a hard guarantee — see below); every write re-verifies the session server-side; strict server-side content validation (string caps, URL allow-list, no HTML/script — everything renders via `textContent`). Discovering the trigger or the API gains nothing without the password.

**Vercel Firewall rate rule (optional hardening, dashboard-only):** Project → Firewall → *Request Rules* (or Rate Limiting) → create a rule: **Match:** path equals `/api/auth`, method equals `POST`, action **Rate Limit** — allow **5 requests** per **15 minutes** per **IP address**, then **Block** (or challenge) for the window. This makes brute-force throttling global across all serverless instances instead of per-instance.

**Environment variables (production):** `ADMIN_PASSWORD`, `SESSION_SECRET`, `VERCEL_API_TOKEN` + `VERCEL_TEAM_ID` (enables editor saves), plus the auto-injected `GLOBAL_CONFIG` connection string. The code also supports the classic `EDGE_CONFIG_ID` + `EDGE_CONFIG_READ_WRITE_TOKEN` pair if you ever move to a classic Edge Config.

## How to update things

**Content (recommended way)** — sign in to `/admin/` (trigger above), edit, save. Changes go live for everyone instantly, no deploy.

**Projects (in code)** — the flagship project (BhuKosh) is a full case study: `<article class="case case-flagship">` in `portfolio/index.html` with a metadata row (Role / Team / Timeline / Stack), Problem → My contribution → System design → Key trade-off → Outcome, a screenshot figure (`portfolio/shots/`), and links. The second project follows the same pattern with the shorter row set. To add a project: duplicate a block, edit the text rows, and point the screenshot at a new file in `shots/`. Empty rows and metadata cells hide automatically.

**Screenshots & résumé (manual, before sending to recruiters)** — `shots/bhukosh.png`, `shots/wikiexplore.png`, and `resume.pdf` are generated **placeholders** (clearly labeled; regenerate via `python make_placeholders.py` from inside `portfolio/`). Replace them with a real capture of the live app/site and a real one-page PDF — same filenames, no code changes needed.

**Skills (in code)** — edit the `<ul>` lists inside `.skill-group` blocks in the Skills section of `portfolio/index.html`. Add a category by duplicating a `.skill-group` div.

**Achievements (in code)** — each item is one `<li class="achievement">` in the Achievements section. Duplicate, edit year/title/text/link. No CSS changes needed.

**Email / social links** — editable in the admin (Contact section) or in code: the email lives in the Contact section button (`data-email` attribute) and the footer of `portfolio/index.html`. LeetCode / X placeholders are commented out there — uncomment and fill the URLs.

**Design tokens** — colors, fonts, spacing, and motion easing are CSS custom properties in the `:root` block at the top of `portfolio/styles.css`. Changing `--accent` re-themes the entire site including the hero scene.

**Hero scene** — all knobs are named constants at the top of `init()` in `portfolio/three-hero.js`: grid density (`COLS`/`ROWS`), `GAP`, point `size`, colors (`base`/`accent`), motion speeds, and parallax strength. Mobile density is set by the `isMobile` branch.

## Three.js behavior (by design)

- pauses rendering when the hero scrolls out of view (IntersectionObserver) and when the tab is hidden
- disabled entirely under `prefers-reduced-motion: reduce`
- static CSS dotted-field fallback if WebGL is unavailable or the scene fails to init
- device pixel ratio capped at 1.5; reduced point count on mobile; antialias off (points don't need it)

## OG share image

`portfolio/og.png` (1200×630) is generated to match the site identity — not a screenshot:

```bash
cd portfolio
pip install pillow
python make_og.py
```

## Deploying to Vercel

1. Push this repo to GitHub
2. Vercel dashboard → **Add New → Project** → import the repo — `vercel.json` sets the static output directory (`portfolio/`); no build command needed
3. Create the Edge Config store + environment variables (see *Private content editing*)
4. Deploy. Add a custom domain later in Project → Settings → Domains

## Local testing

For visual work, serve the site with any static server (e.g. `python -m http.server 8080` from inside `portfolio/`). Without the content API the page uses the bundled fallback content — fully representative of the design.

Testing the editing system end-to-end locally requires the production environment variables and `vercel dev`, which connects to the real content store — treat it as production data.
