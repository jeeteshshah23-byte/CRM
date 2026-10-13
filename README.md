# WorkMate marketing site — homepage prototype v0.1

Plain HTML/CSS/JS + a small Python dev server. Structured to port directly into Next.js (sections → components, `server.py` routes → route handlers/middleware). Next.js wasn't scaffolded because npm is blocked on this network.

## Files
| File | Purpose |
|---|---|
| `index.html` | Homepage markup. `{{NONCE}}` / `{{EXPERIMENTS}}` filled per request by the server |
| `assets/tokens.css` | Copy of `../brand/tokens.css`; re-copy when brand tokens change |
| `assets/site.css` | Layout + components |
| `assets/home.js` | Role switcher, module grid, pricing toggle, demo form, consent, reveal |
| `assets/wm.js` | First-party analytics tracker (spec: `../website-analytics-design.md`) |
| `server.py` | Dev server: security headers, edge A/B assignment, `/e` collector, `/api/demo`, `/_stats` |

## Run
Preview config `workmate-site` (port 9030) serves a copy in `/tmp/claude/workmate-site/`. After editing:
```bash
rsync -a --exclude '*.sqlite3*' ~/Desktop/Claude/JioCRM/site/ /tmp/claude/workmate-site/
```
Local data: `/tmp/claude/workmate-site.sqlite3`. Debug view: `http://127.0.0.1:9030/_stats` (localhost only).
Force an experiment variant: `/?exp_hero_h1=control` or `/?exp_hero_h1=same_page`.

## Verified (2026-10-13)
- No console errors; no horizontal overflow at 375px; tap targets ≥44px
- Nonce CSP unique per request; nosniff, referrer, permissions, COOP headers present
- Collector rejects unknown events and unknown props (e.g. `email`); path traversal 404; honeypot swallowed
- Demo form: client + server validation, work-email rule, success state; lead linked to anonymous_id; `demo_form_submit` recorded server-side
- No typed form values found in any stored analytics event
- Consent: cookieless before consent, `wm_aid` cookie after "Allow"
- Experiment variant assigned server-side, no flicker; exposure event fires

## Not yet done
- Brand fonts not loaded (download blocked); fallbacks render
- Links to `/product/*`, `/pricing`, `/security`, etc. are placeholders (404)
- Demo booking scheduler, sales notification, confirmation email
- HSTS only sent behind HTTPS; Turnstile bot check; production Postgres; rollups/dashboards
- `style-src 'unsafe-inline'` remains (inline `style=` attributes); remove when ported to components
