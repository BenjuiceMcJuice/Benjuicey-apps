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

## 2026-07-14 (session 3) — Retired Formspree, made Resend the notification path

Acting on session 2's decision. Formspree is the wrong tool for a server-side
notification fan-out (spam-filters every Cloudflare-origin POST), so rather than
leave a dead channel firing on every submission, retired it and made Resend the
single notification path. The Resend code was already present and already gated
behind a real `re_` key by session 2's `resendKey()` fix, so this session is a
cleanup + doc pass, not new plumbing.

### Code changes
- **Removed the Formspree path.** Deleted `sendFormspreeNotification` from
  `worker/src/email.ts`, its call in `POST /submit`, and the `FORMSPREE_ENDPOINT`
  field from the `Env` interface (`worker/src/index.ts`). Rationale for the full
  removal (vs just blanking the var): it only ever delivered to Spam, and the
  session-2 write-up above + git history preserve the "why" — dead code with a
  now-misleading "kept for reference" comment is worse than none.
- **`worker/wrangler.toml`:** removed the `FORMSPREE_ENDPOINT` var and its
  comment; the `ADMIN_EMAIL` note now points at Resend, with a short breadcrumb
  explaining why Formspree is gone.
- **Docs:** `docs/feedback-how-it-works.md` notifications section rewritten to
  Resend-only (Formspree kept only as a "why not" warning); `CLAUDE.md` feedback
  bullet updated to name Resend as the path.

### What's left for Ben (only he can do these — no Cloudflare/Resend creds here)
The code is ready; notifications stay dormant until a real key is set:
1. Create a Resend account signed up with `benjuice.apps@gmail.com` (must match
   `ADMIN_EMAIL` — test-mode `onboarding@resend.dev` only delivers to the
   account owner's own address; **no domain verification** needed for self-notify).
2. Make an API key (starts `re_`) → `cd worker && npx wrangler secret put RESEND_API_KEY` → paste it.
3. `npx wrangler deploy`, then submit a test — the admin notification should land
   with no spam filtering.

Confirmation emails to *other* submitters still need a verified domain (change
the `from:` off `onboarding@resend.dev` in `email.ts`) — left off for now.

## 2026-07-14 — Session 3: Technical fault console + ITIL/ITSM spec

Two things: made the admin faults view behave like a real ticketing tool, and
spec'd out where the whole feedback backend is heading (ITIL-aligned ITSM with a
Service Desk triage function).

### 1. Admin `/admin` — from feedback cards to a fault console
Kept the pixel aesthetic (pixel-box, pixel/retro fonts, the dark palette) but
rebuilt the list as a technical, columnar table (`app/admin/page.tsx`):
- **Columns:** REF · STATUS · TYPE · APP · FROM · SUBJECT · LOGGED, aligned via a
  shared CSS-grid template (header + filter row + data rows), horizontally
  scrollable inside a pixel-box on narrow screens.
- **Per-column wildcard filters.** A filter input under every column header.
  `*` is a glob wildcard anchored to the whole cell (`WDA-*`, `*dark mode*`);
  plain text with no `*` is a case-insensitive substring match. Implemented in a
  small `matchesFilter()` (glob → anchored regex, with a substring fallback).
- **Default view = OPEN tickets.** Initial `filters.status = 'open'` so the
  console lands on the open queue, not everything. Status preset buttons
  (all/open/in-progress/done/wont-fix) drive the same status filter; a "clear
  filters (n)" button and a "showing X of Y" counter round out the toolbar.
- **Click-to-sort headers** (asc/desc; status sorts by lifecycle order, LOGGED by
  date, default LOGGED desc). Row still expands to the full detail/notes/status
  editor — unchanged behaviour, restyled to fit.
- Verified with `next build` (types + lint clean).

### 2. `docs/itsm-spec.md` — ITIL-aligned ITSM backend (spec only, not built)
Design doc for turning the flat `submissions` inbox into a lightweight Service
Desk that triages every item into the right ITIL process:
- **Record types:** `incident` / `request` / `query` / `problem` / `change`, with
  a default mapping from today's `bug`/`content`/`request`/`general` `type`s (raw
  value retained as `sourceType`).
- **Triage flow + priority** from an impact × urgency matrix (P1–P4) with advisory
  SLA targets; per-record-type lifecycles; a backwards-compatible schema evolution
  (new fields default sensibly, old statuses map onto the new ITIL states, no
  forced migration).
- **AI triage engine, phased exactly as Ben framed it:** (A) manual — ask Claude
  Code to pull `/admin/submissions`, classify, confirm, write back; (B) scheduled
  (Routine/cron, propose-only first, gated auto-apply later); (C) trigger-on-new
  via the Worker's existing `POST /submit` using `ctx.waitUntil` so triage is
  best-effort and never blocks the save (keeps the platform's "save is source of
  truth" rule). Human-in-the-loop with `triage.confidence`/`rationale` throughout.
- Rollout is phased and each phase is independently shippable; open decisions for
  Ben are listed at the end. Explicitly out of scope: CMDB, asset mgmt, CAB —
  ITIL as vocabulary, not a framework to implement wholesale.

---

## 2026-07-25 — Status workflow redesign: real lifecycle + 7-day auto-close

The four statuses (`open` / `in-progress` / `done` / `wont-fix`) were a feedback
inbox's states, not a service desk's. Replaced them with a proper lifecycle,
made "open" a *view* over that lifecycle, and took closing out of human hands.

### The model — one file, two consumers
`lib/status.ts` is now the single source of truth, imported by **both** the
Worker (`worker/src/*`) and the admin dashboard (`app/admin/page.tsx`) so the
backend and UI can't drift. It holds the enum, labels, colours, sort order, the
settable/open subsets, the legacy map and the auto-close maths.

```
new → in-progress → resolved → closed
        ↕
      pending
```

- `new` — just landed (every submission starts here; `POST /submit` stamps it)
- `in-progress` — shown as **work in progress**
- `pending` — parked, waiting on someone/something else
- `resolved` — believed fixed, still reopenable
- `closed` — settled, **and only ever set automatically**

**`open` is a bucket, not a status:** anything not `resolved`/`closed`, i.e.
`new` + `in-progress` + `pending`. Nothing is stored as `open` any more. The
dashboard's view state was split from the per-column STATUS filter, so the two
compose instead of fighting (the preset buttons used to *be* the status filter).

### Auto-close after 7 days
You can't close a ticket by hand — the dropdown doesn't offer it and the Worker
400s on `{"status":"closed"}` with an explanation. You mark it `resolved`,
which stamps `resolvedAt`, and it closes itself a week later. That week is the
point: time to test the fix, and for a submitter to come back if it didn't hold.
Moving a ticket back to `new`/`in-progress`/`pending` clears `resolvedAt`, so a
reopened ticket never closes on a stale timer.

`worker/src/sweep.ts` is a pure planner (`planStatusSweep`) plus a committer, run
from two places sharing one implementation so nothing closes twice:
- `GET /admin/submissions` sweeps the list it just fetched, before returning it —
  **zero extra reads** (it works off the docs already in memory) and zero writes
  unless something is due. The dashboard can therefore never show a ticket that
  should already have closed.
- A nightly Cloudflare cron (`[triggers] crons = ["30 3 * * *"]` + a `scheduled`
  handler) does the same, so closing doesn't depend on anyone logging in.

### Legacy data migrated in place, no migration script
The same sweep rewrites pre-redesign records the first time it sees them:
`open` → `new`, `done` → `resolved`, `wont-fix` → `closed`. A legacy `done` gets
its 7-day clock *started* then rather than closing instantly. Statuses are also
normalised on read in both the Worker and the UI, so an unswept record can never
render as an unknown status. `wont-fix` is gone as a state: a won't-do item is
`resolved` with a note saying why, and closes like anything else.

### Dashboard
- Six stat tiles (total / open / new / work in progress / pending / resolved),
  each now a **shortcut to that view**; `.admin-stats` moved to `auto-fit` so
  they sit on one row when there's room and stay 2-up on portrait phones.
- Views row: all · open (default) · one per status.
- A `resolved` row shows its countdown inline (`·4d`) and spelled out in the
  detail panel ("auto-closes in 4 days (29/07/2026) — reopen before then if the
  fix didn't hold"). A `closed` row says when, and whether it was automatic.
- The status dropdown offers only the four settable states; an auto-closed ticket
  shows `closed` as a disabled current value, and picking anything else reopens
  it. Bulk status bar likewise lost its `closed` button.
- The STATUS column filter matches the *label*, so `*progress*` finds work-in-
  progress tickets. Column widened to fit the longer label + countdown.
- Bulk updates now track per-ref failures instead of assuming success: failed
  refs stay selected and are named in the error line.

### Plumbing
- `updateSubmission` takes a typed field bag (`status`, `notes`, `resolvedAt`,
  `closedAt`, `autoClosed`) through the generic value encoder instead of
  hand-rolling `stringValue` for two fields — timestamps and nulls now work, so
  clearing a field is expressible. Added `commitSubmissionUpdates` for batched
  sweep writes (one Firestore commit for the whole batch, each with its own
  field mask).
- `PATCH` returns the `resolvedAt` it stamped, so the UI shows the countdown
  without a refetch.
- Root `tsconfig.json` now excludes `worker/` — it has its own tsconfig and
  `@cloudflare/workers-types`, and the new `scheduled` handler's globals don't
  exist under the Next config.

### Verified
- `next build` clean (types + lint); `wrangler deploy --dry-run` bundles the
  Worker including the shared `lib/status.ts` and accepts the cron trigger.
- Sweep policy exercised against fixtures (legacy migration, overdue, exactly-7-
  days boundary, missing `resolvedAt`, already-closed, unknown value, idempotent
  re-run) — all pass.
- Dashboard driven in a real browser against mocked Worker data at desktop and
  portrait-phone widths: open view hides resolved/closed, a legacy `open` record
  renders as `new`, countdown and disabled-`closed` behaviour confirmed.

### Deploy note
The Worker needs a redeploy for any of this to take effect (`cd worker &&
npx wrangler deploy`) — that's also what registers the nightly cron trigger.

---

## 2026-07-25 (session 2) — Closure codes: *why* a ticket ended

The lifecycle said where a ticket was; nothing said why it stopped. Added a
closure code, which is also where the retired `wont-fix` status belongs — it was
never a state, it was a reason.

### The codes
Added to `lib/status.ts` next to the statuses (same one-file-two-consumers rule):

| Code | Use it when |
|---|---|
| `fixed` | it was broken, now it works |
| `implemented` | the requested thing was built or added |
| `answered` | a question or comment answered — nothing to change |
| `wont-fix` | real, understood, deliberately not doing it |
| `duplicate` | already covered by another ticket |
| `cannot-reproduce` | couldn't make it happen; nothing to fix |
| `spam` | not a genuine submission |
| `unspecified` | **not selectable** — backfill for tickets resolved before this existed |

Each carries a one-line hint (`CLOSURE_CODE_HINTS`) that the dashboard shows
under the picker, so the codes stay used consistently months from now.

### Required on resolve, and that shapes the UI
The Worker rejects `status: resolved` without a `closureCode` in the same
request — otherwise the field would drift to "usually blank" and answer nothing.
So resolving in the dashboard is deliberately two steps:

- Picking "resolved" in the status select **doesn't save**. It arms a closure
  code picker beside it with a `RESOLVE →` confirm (disabled until a code is
  chosen) and a cancel. One PATCH carries both fields.
- The bulk bar's `resolved` button became a **"resolve as…"** picker for the
  same reason; new / work in progress / pending stay plain buttons.
- Afterwards the code is editable on its own — a `closureCode`-only PATCH that
  doesn't touch the status, so **correcting a code doesn't restart the 7-day
  clock**. Reopening a ticket clears the code, since it no longer applies.

### Dashboard
- New **CLOSURE** column: `—` while a ticket is open, the code once it's done;
  wildcard-filterable and sortable like the rest (unresolved rows sort last).
  Cell tooltip is the code's hint.
- The STATUS track came down from 168px to 140px so `GRID_MIN_WIDTH` could stay
  at the grid's true minimum (1040) — the whole table, closure column included,
  still fits a laptop window instead of needing a horizontal scroll.
- A closed row's note now reads "auto-closed on 18/07/2026 **as fixed**".

### Sweep / legacy data
- `wont-fix` records migrate to `closed` **keeping their meaning** as
  `closureCode: wont-fix` — information the last change had dropped.
- Legacy `done` → `resolved` gets `unspecified`; so does any resolved ticket
  found without a code (clock-start and auto-close both backfill).
- Caught a bug here in review: the first cut stamped `unspecified` on *every*
  legacy migration, including `open` → `new`, giving unfinished tickets a
  closure code. Now gated on `takesClosureCode(status)`, with two tests pinning
  it (`open → new stays codeless`, `unknown → new stays codeless`).

### Verified
- `next build` + worker `tsc` clean; sweep fixtures extended to 25 assertions
  (code carried through auto-close, backfills, codeless migrations, idempotent
  re-run, label/validation helpers) — all pass.
- Driven in a browser against a mock Worker that enforces the real 400: choosing
  "resolved" sends **zero** requests, the confirm stays disabled with no code,
  and confirming sends exactly one PATCH with
  `{status: resolved, closureCode: cannot-reproduce}`. Bulk "resolve as → spam"
  sends the same shape. Closure select is disabled on tickets that aren't done.

---

## 2026-07-25 (session 3) — Closure notes

The closure code says *which kind* of ending; it can't say what actually
happened. Added `closureNote` — optional free text (≤500 chars, trimmed, blank
means none) captured at the same moment as the code.

It's deliberately separate from `notes`: `notes` is the working scratchpad
("reproduced", "waiting on Sam"), the closure note is the **record of how it
ended** — "was a stale localStorage key", "already covered by WDA-0007",
"single-player by design; netcode is a whole other project". This is the
free-text resolution field `itsm-spec.md` had penciled in as `resolution`; it's
now built under the name that pairs with `closureCode`.

### Where it appears
- **Resolving**: the armed block is now `CLOSURE CODE + NOTE` — code picker,
  note box, `RESOLVE →`, cancel. The note is optional, so the confirm button
  still gates on the code only; Enter in the note box confirms.
- **Afterwards**: its own `CLOSURE NOTE` field with a SAVE, sending a
  `closureNote`-only PATCH — so editing it doesn't touch the status or restart
  the auto-close clock. Disabled (with an explanatory placeholder) on tickets
  that aren't resolved/closed, same as the code.
- **The table**: no new column. The CLOSURE cell's tooltip is now the note when
  there is one, falling back to the code's generic hint.
- Bulk resolves take a code but no note (a note is per-ticket) and clear any
  stale one rather than leaving it attached to a different outcome.
- Reopening clears the note along with the code.

### Layout
The detail panel was getting cramped with four controls across, squeezing both
note inputs to ~130px. Split it into two rows — STATUS + CLOSURE CODE above,
CLOSURE NOTE + INTERNAL NOTES side by side below — so both notes have real
width. The table itself is unchanged.

### Verified
- `next build` + worker `tsc` clean.
- Driven in a browser against a mock Worker that mirrors the real trim/blank
  handling: the note is locked on an open ticket; arming still sends **zero**
  requests; confirm stays disabled with a note but no code; confirming sends one
  PATCH with `{status, closureCode, closureNote}`; editing an existing note
  sends `{closureNote}` alone; a closed row's CLOSURE tooltip shows its note.

---

## 2026-07-25 (session 4) — The Worker deploys itself

The Pages site has always deployed on push to `main`; the Worker needed
`cd worker && npx wrangler deploy` from a machine with `wrangler login`. That
made it the one piece of this platform that couldn't be shipped from a phone —
and the one that could silently drift behind the frontend (an old Worker with a
new dashboard quietly drops fields it doesn't know about).

**`.github/workflows/deploy-worker.yml`** fixes both:

- Triggers on pushes to `main` touching `worker/**`, `lib/**`, or the workflow
  itself. `lib/` is in there deliberately — the Worker imports `lib/status.ts`,
  so a change to the status model or the auto-close window needs a Worker
  deploy, and it would be easy to forget that it isn't "just frontend".
- Also `workflow_dispatch`, with a **dry run** checkbox that typechecks and
  bundles without deploying — handy for verifying the token from a phone.
- Uses the repo's own pinned wrangler (`npm ci` in `worker/`) rather than a
  third-party action, so CI runs exactly what a laptop would.
- Typechecks before deploying; a Worker that doesn't compile never ships.
- `concurrency: worker-deploy` with `cancel-in-progress: false` — queue deploys,
  never cancel one mid-flight.
- Writes a step summary saying what happened and at which commit.

Needs one repo secret, `CLOUDFLARE_API_TOKEN` (Cloudflare's "Edit Cloudflare
Workers" template), plus `CLOUDFLARE_ACCOUNT_ID` only if the token can see more
than one account. That token deploys *code*; the Worker's own secrets
(`GOOGLE_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `ADMIN_PASSWORD`) stay in
Cloudflare and are untouched by a deploy.

### Phone-only from here
Every operational task on this platform is now doable from a browser:

| Task | Where |
|---|---|
| Deploy the Worker | merge, or Actions → Deploy Worker → Run workflow |
| Deploy the site | merge (unchanged) |
| Change a Worker secret | Cloudflare dashboard → Variables (encrypt) |
| Change `ALLOWED_ORIGINS` / the cron | edit `wrangler.toml`, merge |

Documented in `docs/feedback-how-it-works.md` → "Deploying the Worker", with the
token setup steps and a note on deploy ordering. `feedback-standard.md`'s
"adding a new app" step no longer tells you to run wrangler by hand, and
`CLAUDE.md` now says merging *is* the deploy — so a future session doesn't
regress to "run this in your terminal".

Also fixed while here: the Resend setup step said to set the secret with
`wrangler secret put` and redeploy. Secrets take effect immediately with no
redeploy, and the dashboard can set them — both now noted.

### Verified
- Workflow YAML parses; step list and both triggers are as intended. The
  `inputs.dry_run` guards behave correctly on `push` (where `inputs` is empty):
  deploy runs, dry-run step skips.
- `npm ci` in `worker/` from a clean `node_modules` succeeds and leaves the
  lockfile untouched, then `tsc --noEmit` passes — i.e. the workflow's first two
  steps work against the committed lockfile.
- Not yet run for real: it can't be, until `CLOUDFLARE_API_TOKEN` exists. First
  dispatch is the real test.

---

## 2026-07-25 (session 5) — `new` is an arrival state, not a destination

`new` was hand-settable, which made it a lie: it's supposed to mean "nobody has
looked at this yet", and that stops being true the moment you touch the ticket.
It's now system-assigned, exactly like `closed` at the other end.

- `SETTABLE_STATUSES` is down to `in-progress` / `pending` / `resolved`. Added
  `SYSTEM_STATUSES = ['new', 'closed']` documenting *why* each end is off-limits.
- The Worker rejects `{"status":"new"}` with its own message pointing at
  in-progress/pending, alongside the existing `closed` rejection.
- The dashboard generalised its `closed`-only special case: any status that
  isn't settable renders as a greyed-out current value in the select. So a `new`
  ticket shows "new" but offers only the three moves, and reopening a closed one
  goes to in-progress/pending/resolved. The bulk bar lost its `new` button.
- `POST /submit` and the sweep's legacy migration still write `new` directly to
  Firestore — the restriction is on the human PATCH path only, which is the
  point. Pinned by a test (`sweep can still produce new`).

### Verified
- Sweep fixtures now 29 assertions, all pass, including that the migration still
  produces `new` while `SETTABLE_STATUSES` excludes it.
- Driven in a browser across all four cases:
  `new ticket → new (greyed), in-progress, pending, resolved`;
  `in-progress → in-progress, pending, resolved`;
  `closed → closed (greyed), in-progress, pending, resolved`;
  bulk buttons `work in progress, pending`. Zero stray PATCHes.

---

## 2026-07-30 (session 6) — the ticket form is a sheet, not a row

On a phone the per-ticket form was unusable: half of every field ran off the
right-hand edge. The cause wasn't the form's layout, it was where it lived —
it expanded *inside* the fault table's `overflow-x: auto` container, so it
inherited the grid's 1040px `min-width` and laid out at 1040px on a 390px
screen. Nothing inside it could wrap, because as far as the browser was
concerned there was plenty of room.

- Detail moved out of the scroller into a `TicketSheet` overlay rendered after
  the table: full-screen sheet under 560px, centred 620px dialog above it. It's
  sized by the viewport now, so it fits by construction rather than by luck.
- Fields reordered into the order you actually read a ticket, in three
  sections: **THE REPORT** (app, type, from, email, logged, message — nothing
  editable), **TRIAGE** (status → closure code → closure note), **INTERNAL
  NOTES**. `REF` moved into the sheet head with the status and the auto-close
  countdown, so it's still on screen once the body scrolls.
- Text scaled down for the small screen: labels 12px, values/message 16px,
  hints 14px, against the 18–20px the inline panel used. **16px is the floor
  for anything focusable** — iOS Safari zooms the whole page in on a field
  below it, which is its own kind of broken.
- Both note fields are textareas with a `n/500` counter instead of one-line
  inputs (a 500-char cap in a single-line box was a bad joke on a phone). The
  Enter-to-save shortcut goes with them; the SAVE button is right there.
- Sheet behaviour: escape or backdrop-tap closes, body scroll locks while it's
  up, `100dvh` + `env(safe-area-inset-bottom)` keep it clear of Safari's
  toolbar and the home indicator, and choosing "resolved" scrolls the armed
  closure controls into view rather than leaving them below the fold.
- The sheet reads its ticket from `submissions`, not `filtered`, so resolving
  from the `open` view doesn't yank it shut mid-edit.
- Email is a `mailto:` with `Re: <ref>` pre-filled — one tap to reply.
- Table rows are unchanged apart from the trailing `▼` becoming a `›`; the
  table still scrolls horizontally, which is fine now that nothing you need to
  *do* lives inside it.

### Verified
Driven in headless Chromium at iPhone 13 (390px) and 1280px. Sheet width ==
viewport width, `scrollWidth == clientWidth` on the body (no horizontal
overflow anywhere), no console errors, escape closes, and the full resolve flow
— status, code, note, cancel/RESOLVE — fits one phone screen at once.

## 2026-08-04 — work notes: a ticket keeps every update, not just the last one

`notes` was one string, and every save overwrote it. Write "emailed Jane for a
screenshot" on Monday, write "still not reproducible" on Thursday, and Monday
is gone — so a ticket could never tell you what had actually been done to it,
only what you last happened to type. Replaced with an **append-only journal**.

- New shared model, `lib/worknotes.ts` — imported by both the Worker and the
  console, same rule as `lib/status.ts`. A ticket's `workNotes` is a list of
  `{ at, text }` entries, capped at 2,000 characters each.
- `PATCH /admin/submissions/:ref` takes `workNote` and **appends** one entry,
  on its own or alongside a status change. There is no edit and no delete: an
  update that was wrong is corrected by adding another. The Worker stamps `at`
  server-side, so entries stay in one order however many devices you write
  from, and echoes the stored entry back for the UI to render.
- The append is a Firestore `appendMissingElements` transform, not a
  read-modify-write of the array — one atomic call, so simultaneous updates
  can't clobber each other and nothing is lost to a stale copy of the list.
  Set semantics also make a double-tapped ADD UPDATE land once.
- `worker/src/firestore.ts` learned arrays and maps in both directions
  (`toField`/`fromField`); without the read side, `workNotes` came back `null`
  and every ticket looked like it had no journal.
- Console: the sheet's **INTERNAL NOTES** box is now **WORK NOTES** — a text
  area plus `ADD UPDATE`, and the entries beneath it newest-first under their
  timestamps. Drafts survive closing the sheet and are only cleared once the
  append lands.
- The old `notes` field is left alone rather than migrated (its text has no
  date to sit under). Anything already in it shows as **EARLIER NOTES**,
  read-only, with a `clear` button for once it's been moved into an update.
  Nothing writes to it any more.

Status changes are deliberately *not* auto-logged as entries — the journal is
what you wrote, and `resolvedAt` / `closedAt` / `closureCode` already record
the rest.

### Verified
Firestore payloads exercised against a stubbed fetch: an `arrayValue` of
`mapValue`s reads back as `[{at, text}]`, the append transform emits the
documented shape with an `exists: true` precondition, and a new submission
writes `workNotes: []`. UI driven in headless Chromium at iPhone 13 (390px)
and 1280px — journal renders newest-first, ADD UPDATE appends a dated entry
and clears the draft, the legacy block clears, `scrollWidth == clientWidth`
(no horizontal overflow), no console errors.
