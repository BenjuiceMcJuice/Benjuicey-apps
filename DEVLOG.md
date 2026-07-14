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

### Feedback standard (2026-07-11)

Wrote the canonical cross-app standard: **[`docs/feedback-standard.md`](docs/feedback-standard.md)** — the single source of truth every app's DEVLOG points back to. It defines the uniform schema, the canonical `type` categories (`bug`/`content`/`request`/`general`), the `appId`→trigram stamping, and the rule that the **portfolio's own feedback is generic** (`appId: 'portfolio'` → `BEJ`). Companion doc **[`docs/feedback-how-it-works.md`](docs/feedback-how-it-works.md)** explains the end-to-end flow (submit → ref → Firestore writes → email status), the data model, how to review via the admin dashboard/API, and the workflow for having Claude categorise/triage new submissions (manually or scheduled).

Aligned the two surfaces that had drifted to non-canonical `type` values: the portfolio `/contact` form (dropped `collab`/`hi`, now `bug`/`content`/`request`/`general`) and `ai-literate`'s modal (`hi` → `general`). The widget was already canonical.

## 2026-07-14 — Email notifications via Formspree

The feedback pipeline collected everything into the shared Firestore DB but never actually pushed a notification — the only email path was Resend, which sat dormant (no `RESEND_API_KEY`, and confirmation emails need a verified domain). Added a second, zero-setup notification channel using the existing Formspree account.

- New `sendFormspreeNotification` in `worker/src/email.ts` — POSTs each new submission to a Formspree form endpoint, which emails Ben. No verified domain, no API-key secret.
- Wired into `POST /submit` alongside the existing Resend admin notification. Both are independent and best-effort: either, both, or neither can be configured, and a send failure never fails a submission already written to Firestore.
- New `FORMSPREE_ENDPOINT` var in `wrangler.toml` (blank by default — it's a public form URL, not a secret). Set it + redeploy to turn emails on.
- Docs updated (`docs/feedback-how-it-works.md`) with an "Option A — Formspree / Option B — Resend" turn-it-on guide.

### Note on the "one DB for all apps" question
Confirmed: there's a single shared Firestore `submissions` collection; every app that POSTs to the Worker with a registered `appId` lands there, tagged by trigram. Registered apps (`worker/src/trigrams.ts`): portfolio, betalog, ironlog, walkwithme, whatadisaster, ai-literate, dungeonofmontor, benmed. **Caveat:** browser submissions also require the app's live origin to be in `ALLOWED_ORIGINS`. Currently whitelisted: portfolio, ai-literate, whatadisaster, betalog. Registered-but-not-yet-whitelisted (would be CORS-blocked until their domain is added): ironlog, walkwithme, dungeonofmontor, benmed.

## 2026-07-14 (session 2) — Deployed the email path, and why Formspree was the wrong tool

Followed the Formspree work above all the way to a live deploy — and learned the hard way that **Formspree is the wrong notification channel for this architecture.** Writing it up as a learning exercise; the real fix (Resend) is deferred to a later session.

### What we actually got working
- **Deployed the Worker** for the first time this cycle (`npx wrangler deploy` from a fresh clone, after `wrangler login`). Confirmed the DB side is rock-solid: submissions save and get sequential refs (`BEJ-0006` … `BEJ-0012`). The "one shared DB for every app" model is proven end-to-end.
- **First deploy silently sent no email** — turned out `FORMSPREE_ENDPOINT` wasn't on that build; the code skips the send when the endpoint is blank (by design). A redeploy with the var set fixed the *send*, and `wrangler tail` confirmed the Formspree call then succeeded (no error logged).

### Two bugs found and fixed along the way
1. **Anonymous feedback would have been dropped by Formspree.** Formspree validates any field literally named `email` as an address; we were sending `email: "(none given)"` for anonymous submissions, which Formspree rejects — killing the notification exactly when someone leaves no contact info. Fix: only send `email` when present; record anonymity in a non-special field. (`fix: don't send invalid email field to Formspree…`)
2. **The dormant Resend path was firing doomed 400s on every submission.** The `RESEND_API_KEY` secret was a `"skip"` placeholder (with a stray UTF-8 BOM), which is *truthy* — so the Worker kept calling Resend and logging `400 "API key is invalid"`. `wrangler tail` surfaced this. Fix: added `resendKey()` — only treat a value starting with `re_` (BOM/whitespace stripped) as configured, otherwise stay cleanly dormant. (`fix: treat non-'re_' RESEND_API_KEY as unconfigured…`)

### The core learning: Formspree spam-filters server-to-server posts
Every notification landed in Formspree's **Spam** folder (`Spam (4)` and climbing), so no email ever fired — Formspree doesn't email for spam-filtered submissions. Root cause is architectural, not a config we can win:

- In this system **the browser never talks to Formspree.** The app form POSTs to *our Worker*; the Worker POSTs to Formspree server-side. So Formspree only ever sees a **Cloudflare datacenter IP with no browser context** — precisely the fingerprint its Akismet-style filter is built to distrust.
- Our **test data made it worse** (`name: "I am a test"`, `email: "testing@fake.com"`, `message: "Checking it works!!!"` is textbook spam), but **realistic content and marking submissions "Not Spam" still didn't get them into the Inbox.** The datacenter-origin signal dominates.
- Takeaway: **Formspree is designed for a browser posting directly to it** (its own HTML/AJAX/React snippets). Routing it through a server strips the very signals it uses to trust a submission. It's the wrong tool for a server-side notification fan-out.

### Decision — switch to Resend (deferred)
Resend is the right shape: an email API *built* for server-side transactional sending, no spam-scoring of your own mail. For admin-notify-to-self it needs only a free API key — in test mode `onboarding@resend.dev` delivers to the Resend account owner's own address, and `ADMIN_EMAIL` is already `benjuice.apps@gmail.com`, so **no domain verification is needed** for the notification path. The code is already there and now gated behind a real `re_` key by the `resendKey()` fix, so it's dormant until turned on.

**To turn Resend on later:** create a Resend account with `benjuice.apps@gmail.com` → make an API key → `cd worker && npx wrangler secret put RESEND_API_KEY` (paste the `re_…` key) → redeploy. Submit a test; the notification should land with no spam filtering. (Confirmation emails to *other* submitters remain off — those still need a verified domain.)

### Current state
- Code all on `main` and **deployed**. Feedback logging + shared DB: fully working. ✅
- `FORMSPREE_ENDPOINT` is set (`mdavveyq`) but effectively unusable for notifications due to spam filtering — leave it or blank it when Resend goes in.
- Notification emails: **not yet delivering** — waiting on the Resend switch above.
- Still outstanding from before: Dungeon of Montor's `github.io` origin isn't in `ALLOWED_ORIGINS` (the one live app not yet wired for feedback).
