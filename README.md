# Farzan Sayeed Hashmi — Portfolio

Developer portfolio with a spatial navigation system, two engineering case studies, and a Three.js atmosphere — hand-written HTML, CSS, and JavaScript, no framework, no npm/build dependencies. External resources are two CDN loads (Inter font, Three.js module) and nothing else.

**Live:** https://portfolio-farzan4.vercel.app

**Navigation in 20 seconds** ([docs/nav-demo.webm](docs/nav-demo.webm)): the right-edge rail tracks the active section and condenses on scroll-down, and `Ctrl/⌘K` opens a command palette that fuzzy-matches projects — typing "bhu" jumps straight to the BhuKosh case study.

## Navigation: Spatial Command Navigation

The site's defining feature is a layered navigation system (`portfolio/nav.js` + `portfolio/nav.css`), all driven by **one IntersectionObserver source of truth** broadcasting a `nav:section` event:

| Surface | Where | Behavior |
|---|---|---|
| Desktop rail | right edge, ≥1100px | active section dominant; condenses on scroll-down, re-expands on scroll-up or hover; ⌘K chip |
| Mobile bar | bottom, <760px | current-section pill + ⌘K; recedes/returns with scroll direction; opens the section sheet |
| Command palette | every page, Ctrl/⌘K | fuzzy search over sections, projects, case studies, and external links; full keyboard model, focus restore; scoped on case pages |
| Case rail | case-study pages ≥1440px | scroll-spy over the document's own sections |
| Dot surface | hover on the brand dot | quick-jump menu; the 5-click admin trigger is never intercepted |
| Atmosphere | the orb field | `nav:section` modulates drift speed (±15%) and eases a per-section formation shift — atmosphere reacts, it never navigates |

Conventional paths are always intact: the top navbar, footer links, real anchors, and direct URLs. Reduced motion collapses transitions but preserves all state changes. The magnetic hover on the hero CTA is fine-pointer-only and reduced-motion-safe.

## Stack

| Layer | Choice |
|---|---|
| Structure | Semantic HTML5 |
| Styling | Hand-written CSS (design tokens in `:root` of `portfolio/styles.css`) |
| Behavior | Vanilla JS (`portfolio/main.js`, `portfolio/nav.js`, `portfolio/case.js`) |
| Hero visual | Three.js r160 via CDN ESM import (`portfolio/three-hero.js`) + 2D orb field (`portfolio/orb-field.js`) |
| Command palette | `portfolio/nav.js` — zero dependencies |

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
  bhukosh.html         — BhuKosh case study
  wikiexplore.html     — WikiExplore case study
  404.html             — Arrow Escape (playful 404 with a solver-validated puzzle game)
  404.css / 404.js     — the 404 game's styles and engine (solver-validated levels)
  sitemap.xml          — the three public pages
  robots.txt           — allows all, disallows /admin/ and /api/
  styles.css           — design system + all section styles (tokens at the top)
  main.js              — nav state, mobile menu, scroll reveals, email copy, magnetic CTA, hidden editor trigger
  nav.js               — Spatial Command Navigation controller (rail, mobile bar, palette, dot surface, atmosphere link)
  nav.css              — navigation surfaces, breakpoints, reduced-motion rules
  case.js              — case-study reading progress + section spy
  case.css             — case-study layout (hero, pillars, pipeline, decisions, architecture)
  three-hero.js        — Three.js wave-field hero
  orb-field.js         — hero orb layer: the real "thinking orbs" engine (vendored as
                         orb-engine.js, MIT © Jakub Antalik) rendering a field of
                         working-state orbs blended over the wave; pauses off-screen,
                         respects reduced motion
  content.client.js    — hydrates saved content over the fallback (public, ~4 KB)
  content.default.json — bundled fallback content (= what ships in the HTML)
  shots/               — project screenshots (WikiExplore: real captures; BhuKosh: placeholder until its DB is back)
  resume.pdf           — résumé download (placeholder until the real PDF replaces it)
  make_placeholders.py — regenerates the placeholder shots + resume.pdf
  admin/               — private editor (login + forms; noindex)
  favicon.svg
  og.png               — social share image (generated)
  make_og.py           — regenerates og.png (Pillow; run from inside portfolio/)
docs/                  — nav-demo.webm (20-second navigation demo, linked above)
api/                   — serverless functions (Vercel)
  auth.js              — POST login (rate-limited) / DELETE logout
  content.js           — GET public content, PUT authenticated write
  lib.js               — HMAC sessions, throttle, strict content validator
vercel.json            — outputDirectory, noindex header for /admin, no-store for /api
```

Not in the repo: `_qa/` (gitignored) holds local-only QA tooling — a static server with a mocked content API, a deterministic CDP screenshot capturer, and a production link crawler. It never ships and is not needed to run, edit, or deploy the site.

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

**Projects (in code)** — the flagship project (BhuKosh) is a full case study: `<article class="case case-flagship">` in `portfolio/index.html` with a metadata row (Role / Team / Timeline / Stack), Problem → My contribution → System design → Key trade-off → Outcome, a screenshot figure (`portfolio/shots/`), and links. The second project follows the same pattern with the shorter row set, and substantial projects can get a dedicated case-study page (`bhukosh.html` / `wikiexplore.html` show the pattern: reading progress, section rail, palette chip). To add a project: duplicate a block, edit the text rows, point the screenshot at a new file in `shots/` — and add it to the `PROJECTS` list at the top of `portfolio/nav.js` so it appears in the command palette. Empty rows and metadata cells hide automatically.

**Screenshots & résumé (manual, before sending to recruiters)** — `shots/wikiexplore.png` and `shots/wikiexplore-reader.png` are **real live captures** of the deployed site. `shots/bhukosh.png` and `resume.pdf` remain clearly-labeled **placeholders** — replace them with a real capture of the live app (once its database is running) and a real one-page PDF — same filenames, no code changes needed. (The capture tooling that produced the WikiExplore shots lives in the gitignored local `_qa/` folder — any headless-Chrome screenshot flow works.)

**Skills (in code)** — edit the `<ul>` lists inside `.skill-group` blocks in the Skills section of `portfolio/index.html`. Add a category by duplicating a `.skill-group` div. If a project's stack changes, also update the `.skill-evidence` strip right below the skills note — it maps each project (and this site) to the capabilities it demonstrates.

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
