# Farzan Sayeed Hashmi — Portfolio

This is my portfolio, and I built every line of it by hand. No framework, no npm, no build step — just HTML, CSS, and JavaScript that loads fast and works everywhere.

**Live:** https://portfolio-farzan4.vercel.app

Watch 20 seconds of the navigation doing its thing: [docs/nav-demo.webm](docs/nav-demo.webm)

## Why this site is worth your time

**It navigates like nothing else.** A quiet instrument sits on the right edge of the screen, always showing where you are. Scroll down and it steps back; scroll up and it returns. Press `Ctrl+K` (or `⌘K` on a Mac) and a command palette opens — type "bhu" and you're one Enter away from the BhuKosh engineering case study. Every piece of navigation listens to **one** observer, so nothing ever disagrees about where you are.

**The projects are told like engineering, not marketing.** BhuKosh and WikiExplore each get a real case study: the problem, the architecture, the decisions, and the trade-offs — with a reading-progress bar and a section rail that follows you down the page. Every claim on the site is something you can click and verify live.

**The 404 page is a game.** Get lost, and the site hands you "Arrow Escape" — a little puzzle where every arrow must find its way off the board. It's fully keyboard-accessible and it respects reduced motion, because even the easter egg has standards.

**It edits itself.** There's a hidden admin (five clicks on the dot in my name) where content can be changed and saved centrally — no redeploy, no downtime. And no, finding the trigger gets you nothing: everything behind it requires the password server-side.

**It's genuinely fast and genuinely accessible.** Zero dependencies. Keyboard-only navigation works end to end. Reduced motion is honored everywhere. The Three.js hero pauses when you scroll past it and gets out of the way entirely if WebGL fails.

## The pages

| Page | What it is |
|---|---|
| `/` | Who I am, what I build, and proof — projects, skills, achievements, contact |
| `bhukosh.html` | Full case study: evidence-bound land-record AI (Smart India Hackathon 2026) |
| `wikiexplore.html` | Case study: a live Wikipedia reading portal, no backend, no framework |
| `404.html` | Arrow Escape — the puzzle you get to play when you get lost |

---

# Everything, transparently

This half of the README is the complete record: every system on the site, every animation with its real numbers, every decision (including the ones I deliberately did *not* take), and how it was all built and verified. Nothing hidden.

## 1. Navigation — Spatial Command Navigation

The central design problem of the site. Five layers, one brain.

**The brain.** A single `IntersectionObserver` in `portfolio/nav.js` (rootMargin `-40% 0px -55% 0px` — the active band is the middle 5% of the viewport) watches the five homepage sections and broadcasts one custom event, `nav:section`. Every navigation surface listens to that event. There is no second observer, no duplicated logic, no way for two surfaces to disagree. Scrolling fires zero scroll handlers for section detection — the browser does the work.

**The layers:**

| Layer | Where | Exactly what it does |
|---|---|---|
| **Desktop rail** (`.navrail`) | right edge, ≥1100px | Five labeled dots; the active section's dot fills and its label darkens (transition 0.25s). The ⌘K chip on top opens the palette. On scroll-down past 140px (with a 6px threshold so tiny jitters don't trigger it) the rail condenses: labels slide behind dots over 0.3s. Scroll up, hover, or focus anything in it and it re-expands. |
| **Mobile bar** (`.mbar`) | bottom pill, <760px | Shows the current section's name + a ⌘K button. Recedes with scroll-down, returns on scroll-up (0.4s transform/opacity). Tapping the pill opens the **section sheet** — a modal listing all five sections, focus moves in, Escape/backdrop closes it. |
| **Command palette** | every page, Ctrl/⌘K | Opens with Ctrl+K / ⌘K (the keydown listener calls `preventDefault()` so the browser's own Ctrl+K doesn't fire), closes on Escape or backdrop click. Arrow keys move a selection (wrapping, `scrollIntoView({block:'nearest'})`), Enter activates, click activates. Fuzzy matching: substring OR keyword OR subsequence — typing "bhu" finds "BhuKosh". Results are scoped to what exists: home shows all 12 commands; a case page shows only its 7 (sections belong to their own rail there). Closing always returns focus to the element that opened it. On phones it's reachable via the mobile bar's ⌘K button — no keyboard needed. |
| **Case rail** (`.cs-rail`) | case-study pages, ≥1440px | Each case study lists its own sections; a second IntersectionObserver (rootMargin `-35% 0% -55%`) highlights the one you're reading. The palette chip floats bottom-right on case pages — and stays visible at every width because on those pages it's the only command surface. |
| **Dot surface** | hover the brand dot | A small menu (About / Projects / Skills / Contact + ⌘K hint) fades in under the sand-colored dot. It is hover-only decoration on top of real navigation — it never intercepts clicks, so the hidden admin trigger (five clicks on the same dot) still works perfectly. |

**Conventional fallbacks, always on:** the classic top navbar (with working mobile hamburger), the footer links, real anchor links, direct URLs. Kill all JavaScript and the site still navigates. Kill the CSS animations and every state change still happens — instantly.

**The scroll-aware rule both surfaces share:** one `ScrollDirection` helper (rAF-throttled, 6px threshold, arms below y=140) feeds both the rail's condense behavior and the mobile bar's hide/show. One direction signal, two presentations.

## 2. Every animation, with its real numbers

Motion here follows one principle: **80% stillness, 20% motion** — animations communicate state or hierarchy, never decorate. The site-wide easing is `cubic-bezier(0.22, 0.61, 0.36, 1)`. All of it dies under `prefers-reduced-motion: reduce` (see §6).

**Hero entrance.** The eyebrow, name, headline, sub, availability, and CTAs are staggered `.reveal` elements: each starts `opacity:0; translateY(22px)`, transitions to visible over **0.8s** with per-element delays (`--d`): 0 / 0.06s / 0.12s / 0.18s / 0.22s / 0.26s. Above-the-fold elements are made visible *immediately* on load (they ARE the LCP element — reveal-gating them would tank Core Web Vitals); everything below the fold observes normally. The wave-field canvas fades in over **1.6s** (delay 0.2s) once ready; the orb layer over **2.2s** (delay 0.9s).

**Navigation state changes.** Rail dots/labels: 0.2–0.3s color/transform transitions. Rail condense: 0.3s. Mobile bar hide/show: 0.4s. Sheet and palette panels: 0.25–0.35s opacity/transform. Dot surface menu: 0.25s fade. Every value chosen to sit in the "state change, not show" band.

**Scroll reveals.** Sections and cards below the fold reveal at 0.8s translate+fade (delay via `--d`, threshold 0.12 with a -8% bottom rootMargin) and are unobserved after firing (one-shot, no re-animation on scroll-up).

**Magnetic CTA.** The hero's primary button only, only on fine-pointer devices (media query `(pointer: fine)`), only when motion is allowed. The button follows the cursor at 22% of the offset, clamped to **7px**, rAF-batched with the base transition disabled during tracking so it stays crisp; on leave it springs home over **0.4s**. Touch and keyboard users see a completely ordinary button.

**Hover micro-motion.** Arrow-links' → glides 0.25s. Project screenshots zoom 1.015× over 0.5s inside their clipped frame. Buttons lift 1px over 0.3s. The brand dot gets a 0.25s text-shadow bloom when its surface is open.

**The atmosphere.** The orb field (11 orbs desktop, 6 mobile — hand-tuned sizes and depths over a three-column layout in the lower 55% of the hero) drifts on slow sine/cosine paths. The active section modulates two things: drift speed (±15% via `data-section-mod`) and formation (each orb eases toward a per-section offset via `data-section-shift`, exponential settle at 3.5% per frame ≈ 1s, golden-angle spread so neighbors never move in lockstep). Two extra trig calls per orb per frame — that's the entire cost. The atmosphere reacts to navigation; it is never the navigation.

**The Three.js wave field.** Points on a grid animating as a wave, r160 via CDN import map. Pauses via IntersectionObserver when scrolled away and via `visibilitychange` when the tab hides. DPR capped at 1.5, mobile grid density reduced, antialias off. If WebGL fails: a static CSS dotted field takes over — the hero is never empty.

**404 "Arrow Escape" — the deepest animation work on the site.** Every arrow is one continuous axis-aligned polyline. The whole game runs on a single parameter: arc distance `s` along the arrow's extended path.
- *Spawn:* arrows scale in from 55% with a slight overshoot, 300ms each, staggered 15ms apart.
- *Traversal:* the head travels the real winding route at 18 grid units/sec, its tangent rotating through each 90° bend over ~40ms — turns, never snaps. The visible line is one dash-window sliding along the path; forward travel, reversal, and exit are literally the same mechanism with `s` going up or down.
- *Blocked run:* approach → stop 0.15 units short of the blocker → red flash (#ff3344) holding 140ms → tiny 70ms thrust bump → the parameter runs **backward** through the exact travelled arc at 1.4× speed with exponential deceleration (bisection-solved arrival time), then the arrow settles home. No straight-line shortcut, ever.
- *Escape:* EaseInCubic exit acceleration blended 62.5% with linear so it joins the boundary at speed, then a 100ms fade.
- *Hearts:* loss plays a 480ms fracture animation (burst → clip-path breakup → drop → settle into an empty outline diamond). A 110ms board shake accompanies impacts; haptic `navigator.vibrate(15)` on mobile.
- *Victory:* 560ms board settle pulse, then quiet pooled-canvas confetti (160 particles, gravity 1.15 u/s², drag 1.8/s, fan ±55°), then the banner scales in 0 → 1.2 → 1.0 over 350ms (EaseOutBack) with 60/110/170ms child staggers.
- *Integrity:* every level is validated by a built-in backtracking solver with state-hashing at load — a level that can't ship never renders. An epoch counter orphans every in-flight animation on restart. Keyboard: arrows are real buttons (Enter/Space activate), hint pulses a valid arrow at 1.00→1.14 scale per second, R restarts, `#level-N` deep links work.

## 3. How the website works (the simple version)

- **One observer decides where you are.** An IntersectionObserver watches the page's sections and broadcasts a single `nav:section` event. The desktop rail, the mobile bottom bar, and the orb field all listen to that one event — so they always agree.
- **The command palette searches everything.** Sections, projects, case studies, and external links — with fuzzy matching, full keyboard control, and focus returned where it came from when you close it.
- **Case studies navigate themselves.** Their own rail tracks the section you're reading, a thin bar shows how far through the story you are, and the palette is scoped to what exists on that page.
- **The atmosphere listens but never leads.** The orb field subtly changes speed and formation as you move between sections. It reacts to navigation; it never is the navigation.
- **Nothing depends on anything fancy.** No JavaScript framework, no hover-only paths, no WebGL required. If a fancy layer fails, the plain links, the menu, the footer, and the palette still work.
- **Content has a source of truth.** The site ships with bundled content; a hidden admin can save new content centrally, and every visitor gets it instantly. If the store is ever down, the bundled content takes over silently — the site never breaks.

## 4. Content system & admin

- `portfolio/content.default.json` is the baseline content bundled into the shipped HTML — the site is fully rendered without any API.
- `content.client.js` (~4 KB, public) fetches `/api/content` and hydrates saved content over the fallback. If the API is missing or errors, nothing happens — the bundled content stands.
- `admin/index.html` + `admin/admin.js` is the editor: it signs in against `/api/auth` (rate-limited), loads/saves via `/api/content` (PUT, authenticated), keeps an unsaved draft in `localStorage` (`pf_admin_draft_v1`) with a restore bar, previews screenshots before save, and confirms saves with a diff summary + an 8 KB size meter against the store limit.
- The hidden trigger: five clicks within three seconds on the brand dot → silent navigation to `/admin/`. Obscurity is convenience, not security — see the security model below.

## 5. SEO

- Titles, meta descriptions, canonical URLs, and Open Graph/Twitter cards on all three public pages — all factual.
- `sitemap.xml` lists exactly the three real pages with priorities; `robots.txt` allows everything except `/admin/` and `/api/`, and each page references the sitemap from `<head>`.
- Semantic HTML throughout: one `h1` per page, logical heading order, real `<nav>`/`<section>`/`<article>` landmarks, skip links, `aria-current` on the active nav item (synced via MutationObserver on the homepage).
- JSON-LD `Person` structured data on the homepage: name, role, school, GitHub, LinkedIn. No fabricated metrics anywhere.
- All navigation is crawlable: the palette and rails are enhancements over plain `<a href>` links that exist in the HTML.
- OG image (`og.png`, 1200×630) generated to match the site identity (`make_og.py`).

## 6. Accessibility

- Semantic HTML, skip links, logical heading hierarchy, real links and buttons everywhere.
- The palette is a proper `role="dialog"` with `aria-modal`, labelled input, `role="listbox"`/`option` results with `aria-selected`, full arrow/Enter/Escape model, and focus restore.
- The mobile sheet is the same: dialog semantics, focus moves in on open, Escape closes.
- Visible `:focus-visible` outlines site-wide; touch targets sized for thumbs; safe-area insets respected on the mobile bar and sheet (`env(safe-area-inset-bottom)`).
- Contrast: body text ~15:1, secondary text ~7:1, metadata (deliberately quieter) ~4.6:1 — all pass their WCAG bands.
- **`prefers-reduced-motion: reduce`**: scroll-behavior off, all reveals shown instantly, hero canvases shown without entrance animation, scroll-cue and hover transforms off, orb field renders a single static frame, the 404 game disables its traversal choreography (blocked taps cost the heart with a plain flash), and every navigation surface swaps its transitions for instant state changes.
- Nothing is hover-only: every hover affordance has a focus/click/touch path.

## 7. Performance

- Zero npm dependencies, zero build step. Two CDN requests total (Inter font, Three.js module).
- IntersectionObserver for section tracking, reveals, and render-pausing — no scroll-position math on the hot path (the one style-write per scroll event on case pages is width-based, exact at any DPI).
- GPU-friendly transforms only (`transform`/`opacity`); the magnetic CTA and scroll-direction logic are rAF-batched.
- DPR capped at 1.5 on both canvases; the wave field and orb field both stop entirely when off-screen or when the tab is hidden; fewer orbs on mobile.
- Images: lazy-loaded, `decoding="async"`, explicit dimensions (no layout shift), WebP-free PNGs optimized at capture time (WikiExplore shots: 198 KB + 269 KB).
- Fonts: one Google Fonts request, `display=swap`, preconnected.

## 8. Engineering decisions — including the "no"s

A portfolio is defined as much by what it refuses as what it does:

- **No framework.** React/Vite would add a build step and ship more bytes than the entire site's logic. The whole navigation system is ~460 lines of vanilla JS.
- **No horizontal-scroll storytelling.** This site contains technical material people read on trains. Vertical scrolling, always.
- **No glassmorphism, no neon, no AI-gradient purple.** Dark editorial, warm sand accent (#d3a95c), hairline borders. The palette is the brand.
- **No fabricated content, ever.** Every claim maps to something verifiable: the BhuKosh demo credentials are published on purpose, the WikiExplore stats are what Wikimedia's feed actually serves, the screenshots of WikiExplore are real captures of the deployed site. BhuKosh's screenshot stays an honest labeled placeholder until its database is back online rather than faking a capture.
- **`/work/bhukosh` URLs declined.** Clean, but it would break the URLs recruiters may already have saved. `bhukosh.html` stays.
- **No Lab/experiments section.** The private projects exist but have nothing that can be shown publicly; a section of empty boxes would be decoration, not content.
- **The 404 game was preserved, not diluted.** It would have been easy to trim it for consistency. Instead the navigation system borrowed its design language (mono labels, hairlines, sand accent) and left the game alone.
- **One source of truth or it doesn't ship.** Both navigation surfaces — and the atmosphere — run off the single `nav:section` event. During QA, a plan to gate surfaces with JS `matchMedia` was scrapped in favor of "render both, CSS decides": mid-conversation rotation/resize bugs are impossible that way.

## 9. How it was built & verified (the QA log)

Every feature above was verified in a real browser against a local mock server and, after each push, re-verified against production:

- **Navigation:** rail active-state tracked through all five sections; condense verified at scroll 2200 (class present) and re-expand at 1600; mobile bar hidden on desktop, visible and functional at 390px; sheet open/close/focus verified; palette: Ctrl+K, "bhu" → BhuKosh, arrow/Enter/Esc model, focus restore verified on home and case pages; palette chip present on case pages at every width (a mobile gap was found in QA and fixed: the chip used to hide below 760px, leaving phones with no command surface on case pages).
- **Cross-page wiring:** one `nav:section` event verified updating rail + mobile bar + orb-field seed simultaneously; homepage project cards link to both case studies; case studies cross-link each other and the homepage; all cross-page fragments resolve.
- **Responsive:** 1600/1280/900/390 widths checked for overflow (none), nav correctness per band, and touch reachability; safe-area insets verified in CSS.
- **Accessibility:** keyboard-only pass (Tab order, palette focus trap + restore, 404 game fully playable via Enter/Space), reduced-motion pass, aria-current sync, contrast checks.
- **404 game:** solver validates all levels at load; a full run (spawn → traversal → blocked run → heart loss → victory → next level) exercised in the recorded demo session.
- **Production crawl:** all 4 pages 200; every internal asset 200; every external link verified (BhuKosh app/API URLs listed but deliberately never requested while its database is paused). The crawl caught one real defect — `/_vercel/insights/script.js` 404ing for every visitor because Vercel Web Analytics wasn't enabled — and the dead tags were removed.
- **Screenshots:** WikiExplore captures taken with a deterministic headless-Chrome CDP flow, cropped and optimized; BhuKosh's placeholder kept until its backend is resumed.
- **Admin:** draft autosave/restore, save modal with diff summary and size meter, and the 5-click trigger verified intact after every navigation change (the dot surface never intercepts the clicks).

## 10. Commit history (the build log)

The whole build, in order, as pushed:

1. `bc25bca` — admin redesign
2. `626a5d6` — draft autosave + screenshot thumbnails in the editor
3. `f48113d` — hover depth polish
4. `960af18` — case-study reading UX (progress bar + section rail) + admin save modal with diff summary and size meter
5. `1b0a974` — accessibility audit: metadata contrast, nav `aria-current`, immediate hero paint
6. `8f9ed7c` — **Spatial Command Navigation**: section rail, mobile bar, command palette (+`nav.js`, +`nav.css`)
7. `46f4303` — **WikiExplore case study** page wired into nav, palette, and both project pages; mobile palette-chip fix
8. `d24a003` — real WikiExplore captures + sitemap polish (all pages reference the sitemap)
9. `8fbb9bd` — section-aware atmosphere reorganization + magnetic primary CTA
10. `d073dae` — skill-evidence strip + the production-crawl fix (insights tags removed)
11. `89747ba` — README overhaul + `docs/nav-demo.webm`
12. `65d4a80` — README audit (accuracy fixes)
13. `66ca9a0` — README voice rewrite

---

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

## Stack

| Layer | Choice |
|---|---|
| Structure | Semantic HTML5 |
| Styling | Hand-written CSS (design tokens in `:root` of `portfolio/styles.css`) |
| Behavior | Vanilla JS (`portfolio/main.js`, `portfolio/nav.js`, `portfolio/case.js`) |
| Hero visual | Three.js r160 via CDN ESM import (`portfolio/three-hero.js`) + 2D orb field (`portfolio/orb-field.js`) |
| Command palette | `portfolio/nav.js` — zero dependencies |

**Dependency note:** "no dependencies" means no npm packages, no build step, no framework. The page does load two external resources from CDNs (the Inter font and the Three.js module). Keep the importmap pinned — it is the only Three.js reference.

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
