# Feedback Standard — All Benjuicey Apps

**This is the single source of truth for how feedback works across every app Ben builds.**
Every app's own DEVLOG links back here. If you're adding feedback to an app, follow this — don't invent a new mechanism.

> **Companion doc:** [`feedback-how-it-works.md`](feedback-how-it-works.md) explains the end-to-end flow (what happens on submit, the database writes, emails) and how to review/triage submissions — including having Claude categorise new feedback. This doc is the *standard*; that one is *how it works*.

---

## The principle

One feedback system, one place all submissions land, one uniform shape — no matter which app (or the portfolio) they came from.

- **Same format everywhere.** Every submission has the same fields and the same `type` categories.
- **Each app stamps its own identity.** A submission carries the app's `appId`, which the backend maps to a 3-letter trigram and a per-app reference number (e.g. `WDA-0001`).
- **The portfolio site is generic.** Feedback from the main Benjuicey Apps portfolio itself is stamped `appId: 'portfolio'` → trigram `BEJ`. It is not tied to any single app — it's the catch-all / "generic" bucket.

## How it works (the backend)

Apps never write feedback to their own database. They all `POST` to one shared Cloudflare Worker, which writes server-side to one shared Firestore project (`benjuicey-apps`).

- **Endpoint:** `POST https://benjuicey-feedback.benjuicemcjuice.workers.dev/submit`
- **Worker source:** `worker/src/` in this repo
- **Admin view:** the portfolio site's `/admin` dashboard reads/manages every app's submissions in one list
- The Worker generates the per-app reference number and returns it (`{ success: true, ref: "WDA-0001" }`)

## The uniform submission schema

Every submission — from an app or the portfolio — is exactly these fields:

| Field | Required | Notes |
|---|---|---|
| `appId` | ✅ | Identifies the source app. `'portfolio'` for the portfolio site itself. Must be a registered id (see `worker/src/trigrams.ts`). |
| `name` | ✅ | Submitter's name |
| `email` | — | Optional, for a reply |
| `type` | ✅ | One of the canonical categories below |
| `message` | ✅ | Free text |

### Canonical `type` categories

**Use exactly these four values everywhere.** Label wording may match each app's tone/voice, but the underlying value must be one of these so the combined dataset stays analysable:

| Value | Meaning |
|---|---|
| `bug` | Something is broken |
| `content` | Something is wrong or unclear (accuracy / clarity) |
| `request` | Feature or content suggestion |
| `general` | General feedback / just saying hi |

### Status is the backend's business

Apps never send a `status` — the Worker stamps every new submission `new` and it
moves through one shared lifecycle (`new` → `in-progress` / `pending` →
`resolved` → `closed`) in the admin dashboard, ending with a **closure code**
saying why (`fixed`, `wont-fix`, `duplicate`…) and an optional **closure note**
with the specifics. The canonical enums live in
[`lib/status.ts`](../lib/status.ts); the rules (including why `closed` can only
be reached by the 7-day auto-close) are in
[`feedback-how-it-works.md`](feedback-how-it-works.md#the-ticket-lifecycle-statuses).

## Two ways an app can conform

1. **Drop in the shared widget (preferred for new apps).** One script tag, no form to build:
   ```html
   <script defer
     src="https://benjuicey-feedback.benjuicemcjuice.workers.dev/widget.js"
     data-app-id="your-app-id"
     data-accent="#RRGGBB"></script>
   ```
   Options: `data-app-id` (required), `data-accent` (theme colour), `data-position` (`br`/`bl`), `data-no-button` (suppress the built-in floating button and trigger it yourself via `window.BenjuiceyFeedback.open()`). The widget uses the canonical schema and categories automatically, and dispatches a `benjuiceyfeedback:submitted` window event on success for any app-side analytics hook.

2. **Use your own styled form (portfolio, ai-literate).** Fine to keep a bespoke form that matches the app's design — but it **must** POST the exact schema above (same fields, same canonical `type` values, correct `appId`).

## Adding a new app

1. Pick a 3-letter trigram and register it in `worker/src/trigrams.ts` (`TRIGRAMS` + `APP_NAMES`).
2. Add the app's live origin(s) to `ALLOWED_ORIGINS` in `worker/wrangler.toml` and merge to `main` — the Worker redeploys itself (`.github/workflows/deploy-worker.yml`). See [`feedback-how-it-works.md`](feedback-how-it-works.md#deploying-the-worker).
3. Embed the widget (or conform your own form) with the new `appId`.

## Adoption status

| App | Trigram | Feedback | Mechanism |
|---|---|---|---|
| Portfolio (this repo) | `BEJ` (generic) | ✅ Live | Own `/contact` form → Worker, `appId: 'portfolio'` |
| AI-Literate | `LIT` | ✅ Live | Own styled modal → Worker |
| Whatadisaster | `WDA` | ✅ Live (pending merge) | Shared widget |
| BenMed | `MED` | ❌ Not yet | To adopt — shared widget |
| BetaLog | `BTL` | ❌ Not yet (mailto only) | To adopt — shared widget |
| Dungeon of Montor | `DOM` | ❌ Not yet | To adopt — shared widget |
| Walk With Me | `WLK` | ❌ Not yet | To adopt — shared widget |
| IronLog | `IRN` | ❌ Not yet | To adopt — shared widget |

_Trigrams are registered in `worker/src/trigrams.ts`; an app appearing there does not mean feedback is wired up yet — this table is the real status._
