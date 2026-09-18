# Farzan Sayeed Hashmi — Portfolio

Single-page developer portfolio. Hand-written HTML, CSS, and JavaScript with a Three.js wave-field hero — no framework, no npm/build dependencies. External resources are two CDN loads (Inter font, Three.js module) and nothing else.

**Live:** deployed as a static site on Vercel (URL added after first deploy)

## Stack

| Layer | Choice |
|---|---|
| Structure | Semantic HTML5 |
| Styling | Hand-written CSS (design tokens in `:root` of `styles.css`) |
| Behavior | Vanilla JS (`main.js`) |
| Hero visual | Three.js r160 via CDN ESM import (`three-hero.js`) |

**Dependency note:** "no dependencies" above means no npm packages, no build step, no framework. The page does load two external resources from CDNs (the Inter font and the Three.js module). Keep the importmap pinned — it is the only Three.js reference.

## Local development

No install step. Either open `index.html` directly, or serve the folder (recommended — module imports behave exactly like production):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## File structure

```
portfolio/
  index.html            — structure + bundled fallback content
  styles.css            — design system + all section styles (tokens at the top)
  main.js               — nav state, mobile menu, scroll reveals, email copy, hidden editor trigger
  three-hero.js         — Three.js wave-field hero
  content.client.js     — hydrates saved content over the fallback (public, ~4 KB)
  content.default.json  — bundled fallback content (= what ships in the HTML)
  admin/                — private editor (login + forms; noindex)
  favicon.svg
  og.png                — social share image (generated)
  make_og.py            — regenerates og.png (Pillow)
  README.md
api/
  auth.js               — POST login (rate-limited) / DELETE logout
  content.js            — GET public content, PUT authenticated write
  lib.js                — HMAC sessions, throttle, strict content validator
vercel.json             — outputDirectory, noindex header for /admin, no-store for /api
mock-store.js           — test-only local fake of Edge Config (see below)
start-store.cmd / start-dev.cmd — test-only launchers for local API testing
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
| **Local dev** (`start-dev.cmd`) | `test-pass-12345` | Baked into the test launcher only |

> ⚠️ **If this repository is ever made public, change the production password first** (`vercel env add ADMIN_PASSWORD production`, enter the new value, then redeploy). The hidden trigger is convenience only — all editing requires the password server-side; discovering `/admin/` or the trigger grants nothing.

### Setup (once, at deploy)
1. Create an Edge Config store in the Vercel dashboard (Storage tab)
2. Environment variables for the project:
   - `ADMIN_PASSWORD` — your editor password (long, unique)
   - `SESSION_SECRET` — long random string (e.g. `openssl rand -base64 32`)
   - `EDGE_CONFIG_ID` + `EDGE_CONFIG_READ_WRITE_TOKEN` — from the Edge Config store
3. Redeploy. Open `/admin/`, sign in, edit, **Save changes** — content is stored centrally and served to every visitor. No redeploy needed for content changes.

**Fallback behavior:** `content.default.json` is the site's baseline. If the store is unconfigured or errors, visitors silently get the bundled content — the site never breaks. To keep the bundled fallback in sync with centrally saved content: after a save, open `https://<your-domain>/api/content`, copy the `content` object into `content.default.json`, and include the change in your next code deploy (crawl-time SEO reads the HTML, which ships this file).

**Security model:** password only in env vars; HMAC-signed HttpOnly SameSite=Lax Secure session cookie (14 days); in-memory login throttle (5 fails / 15 min / serverless instance — best-effort on cold starts, so also add a Vercel Firewall rate rule on `POST /api/auth` for a hard guarantee); every write re-verifies the session server-side; strict server-side content validation (string caps, URL allow-list, no HTML/script — everything renders via `textContent`). Discovering the trigger or the API gains nothing without the password.

## How to update things

**Projects** — each project is one `<article class="case">` block in `index.html`. Duplicate a block and edit the text rows (`What it is` / `Why it exists` / `How it works`), tags, and links. To change an abstract visual, edit the inline SVG inside `.case-visual` — it's plain markup, no assets.

**Skills** — edit the `<ul>` lists inside `.skill-group` blocks in the Skills section of `index.html`. Add a category by duplicating a `.skill-group` div.

**Achievements** — each item is one `<li class="achievement">` in the Achievements section. Duplicate, edit year/title/text/link. No CSS changes needed.

**Email / social links** — the email lives in the Contact section button (`data-email` attribute) and the footer. Social links are the `.contact-links` and `.footer-links` anchors. LeetCode / X placeholders are commented out in `index.html` — uncomment and fill the URLs.

**Design tokens** — colors, fonts, spacing, and motion easing are CSS custom properties in the `:root` block at the top of `styles.css`. Changing `--accent` re-themes the entire site including the hero scene.

**Hero scene** — all knobs are named constants at the top of `init()` in `three-hero.js`: grid density (`COLS`/`ROWS`), `GAP`, point `size`, colors (`base`/`accent`), motion speeds, and parallax strength. Mobile density is set by the `isMobile` branch.

## Three.js behavior (by design)

- pauses rendering when the hero scrolls out of view (IntersectionObserver) and when the tab is hidden
- disabled entirely under `prefers-reduced-motion: reduce`
- static CSS dotted-field fallback if WebGL is unavailable or the scene fails to init
- device pixel ratio capped at 1.5; reduced point count on mobile; antialias off (points don't need it)

## OG share image

`og.png` (1200×630) is generated to match the site identity — not a screenshot:

```bash
pip install pillow
python make_og.py
```

## Deploying to Vercel

1. Push this repo to GitHub
2. Vercel dashboard → **Add New → Project** → import the repo — `vercel.json` sets the static output directory; no build command needed
3. Create the Edge Config store + environment variables (see *Private content editing*)
4. Deploy. Add a custom domain later in Project → Settings → Domains

## Local testing of the editing system

`vercel dev` runs the API locally, and `mock-store.js` fakes the Edge Config REST API so the full loop (login → edit → save → hydrate) works without a Vercel account:

```cmd
cd /d C:\Users\farza\github\portfolio
start-store.cmd   :: mock Edge Config on 127.0.0.1:8499
start-dev.cmd     :: vercel dev on 127.0.0.1:8440 (test creds baked in)
```

Then set `EDGE_CONFIG_API=http://127.0.0.1:8499` in the dev environment (the launchers do this) and use the trigger → `/admin/`. These three files are development helpers — safe to delete before a production push.

After the final URL is known, update the `canonical` link and `og:url` in `index.html` (currently a placeholder) and re-run `make_og.py` if you want the URL on the share image.
