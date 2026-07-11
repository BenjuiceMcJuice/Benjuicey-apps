# Devlog — Benjuicey Apps

## 2026-06-21 — Session 1: Feedback infrastructure + admin dashboard

### What got built

**Firestore**
- Created `benjuicey-apps` Firebase project
- Firestore database enabled (europe-west2, Spark plan)
- Security rules locked down — all client-side access denied, only the Worker's service account can read/write

**Cloudflare Worker (`worker/`)**
- Worker deployed at `https://benjuicey-feedback.benjuicemcjuice.workers.dev`
- `POST /submit` — accepts feedback from any app, generates sequential per-app ref IDs (e.g. `BEJ-0001`), writes atomically to Firestore via transactions
- `GET /admin/submissions` — returns all submissions, password protected
- `PATCH /admin/submissions/:ref` — update status/notes, password protected
- Auth via `x-admin-password` header checked against `ADMIN_PASSWORD` secret
- Secrets stored in Cloudflare: `GOOGLE_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY` (placeholder), `ADMIN_PASSWORD`

**Next.js site**
- Contact form (`/contact`) updated from Formspree to the Worker
- Admin dashboard (`/admin`) — password gate, submission list, status filters, inline status updates and internal notes
- App listings filled in with real apps (BetaLog, Whatadisaster, AI-Literate, Dungeon of Montor)
- Deployed to Cloudflare Pages at `benjuicey-apps.pages.dev`, auto-deploys from `main`

**Trigrams locked in** (`docs/trigrams.md`):

| Trigram | App |
|---------|-----|
| `BEJ` | Benjuicey Apps (portfolio) |
| `MED` | BenMed |
| `BTL` | BetaLog |
| `IRN` | IronLog |
| `WLK` | Walk With Me |
| `WDA` | Whatadisaster |
| `LIT` | AI-Literate |
| `DOM` | Dungeon of Montor |

### Known issues / TODO
- Buy Me a Coffee link in nav 404s — need to create account at buymeacoffee.com/benjuicey
- Email confirmations skipped for now (Resend placeholder) — needs a verified domain
- Next.js 14.2.30 has a flagged security vulnerability — upgrade when convenient

### What's next
- **AI analysis** — Claude API button in admin to analyse patterns across all submissions

## 2026-07-11 — Embeddable feedback widget

Whatadisaster had drifted: it had built its own standalone Firebase project + Firestore `feedback` collection instead of using this platform's Worker, because the "embeddable widget" piece didn't exist yet to make that easy. Built it now and used it to bring Whatadisaster in line — same pattern applies to any future app.

- New `GET /widget.js` route on the Worker (`worker/src/widget.ts`) — self-contained, themeable script. Reads `data-app-id` (required), `data-accent` (hex, optional), `data-position` (`br`/`bl`), `data-no-button` (suppress the built-in floating button if the host app wants to trigger it itself via `window.BenjuiceyFeedback.open()`).
- Same field contract as `ai-literate`'s hand-rolled modal (name, email optional, type, message) so submissions stay uniform across apps.
- Dispatches a `benjuiceyfeedback:submitted` window event with `{appId, ref, type}` on success, so host apps can hook their own analytics without needing a callback API.
- Added `whatadisaster.uk` / `whatadisaster.pages.dev` to `wrangler.toml` `ALLOWED_ORIGINS`.
- `ai-literate` still runs its own hand-rolled modal — could migrate it to `/widget.js` later for consistency, not done yet.
