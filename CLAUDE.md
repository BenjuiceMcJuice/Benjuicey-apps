# CLAUDE.md — Benjuicey Apps

Guidance for Claude working in this repo. Read this before wiring up new
integrations (feedback, CORS, notifications, etc.).

## Scope rule: only spend effort on apps that are LIVE on the portfolio

The portfolio page is the source of truth for what's worth working on. An app
"counts" only if it appears in **`data/categories.ts`** (the app directory
rendered on the Benjuicey Apps homepage). Currently live there:

| App | `appId` | Live URL / origin |
|---|---|---|
| BetaLog | `betalog` | https://betalog.co.uk |
| What a Disaster | `whatadisaster` | https://whatadisaster.uk |
| AI-Literate | `ai-literate` | https://ai-literate.uk |
| Dungeon of Montor | `dungeonofmontor` | https://benjuicemcjuice.github.io/dungeonofmontor |

**Do NOT spend effort on apps that aren't listed on the portfolio page.**
Some appIds/trigrams are registered in `worker/src/trigrams.ts` (e.g.
`ironlog`, `walkwithme`, `benmed`) but are not live on the page — leave them
alone unless they're added to `data/categories.ts` first. Registering a
trigram is cheap and harmless; wiring CORS origins, feedback widgets, or
notifications for a non-live app is wasted effort.

When asked to "wire up all the apps" or similar, wire up **only the live ones**
and flag the rest rather than guessing at domains for apps that may not exist.

## Feedback system (the main shared infrastructure)

One Cloudflare Worker collects feedback from every live app into one shared
Firestore `submissions` collection, then fires a best-effort notification
email. Full write-up: **`docs/feedback-how-it-works.md`**; rules/schema:
**`docs/feedback-standard.md`**.

- The Worker (`worker/src/index.ts`) both writes to Firestore **and** sends the
  notification in the same `/submit` request — the DB has no triggers of its
  own. The save is the source of truth; the email is best-effort and never
  blocks a saved submission.
- Notifications: **Formspree** (`FORMSPREE_ENDPOINT` in `wrangler.toml`, no
  domain/secret needed — the easy path) and/or **Resend** (`RESEND_API_KEY`
  secret). Either, both, or neither.
- A browser submission only reaches the Worker if the app's origin is in
  `ALLOWED_ORIGINS` (`worker/wrangler.toml`). Add an origin here **only** for a
  live portfolio app — and use its *real* origin (Dungeon of Montor is on
  `github.io`, not `.pages.dev`).
