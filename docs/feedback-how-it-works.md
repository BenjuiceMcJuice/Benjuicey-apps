# Feedback — How It Works (End to End)

Plain-English explanation of what happens when someone submits feedback from any app, where it goes, and how to review/triage it. For the *rules* (schema, categories, adoption), see the companion doc **[`feedback-standard.md`](feedback-standard.md)**.

---

## The one-paragraph version

A user fills in a feedback form in any app (or the portfolio). Their browser sends it to one shared Cloudflare Worker. The Worker gives it a reference number (e.g. `WDA-0001`), saves it to one shared Firestore database, and returns the reference so the user sees "logged as WDA-0001". You read everything back in one place — the admin dashboard on the portfolio site. **Nothing pushes a notification to you** — you (or a scheduled Claude task) pull the list when you want to review it.

---

## Step by step: what happens on submit

```
User fills form in App X
        │  (name, email?, type, message)
        ▼
Browser POSTs JSON to the Worker
   https://benjuicey-feedback.benjuicemcjuice.workers.dev/submit
   { appId: "whatadisaster", name, email, type, message }
        │
        ▼
Worker validates
   • appId, name, message present?      → no: 400 error
   • appId maps to a known trigram?     → no: 400 error
        │
        ▼
Worker authenticates to Firestore
   (Google service-account token, server-side — the browser never touches the DB)
        │
        ▼
Firestore transaction (atomic — all or nothing):
   1. read  counters/{trigram}          e.g. counters/WDA → 0
   2. write counters/{trigram}          → 1
   3. write submissions/{ref}           → the submission, ref = "WDA-0001"
        │
        ▼
Worker returns { success: true, ref: "WDA-0001" }
        │
        ├──▶ Widget shows the user "logged as WDA-0001"
        │
        ├──▶ Admin notification email to Ben (Resend, once a real
        │    RESEND_API_KEY is set — see "Emails & notifications" below)
        │
        └──▶ IF an email was given: tries to send a confirmation email
             (Resend only; off until a domain is verified)
```

### What gets written to the database

Each submission is one document at `submissions/{ref}`:

| Field | Example | Set by |
|---|---|---|
| `ref` | `WDA-0001` | Worker (sequential per app) |
| `appId` | `whatadisaster` | the app |
| `trigram` | `WDA` | Worker (from appId) |
| `type` | `bug` | the user (`bug`/`content`/`request`/`general`) |
| `status` | `new` | Worker (always starts `new` — see the lifecycle below) |
| `name` | `Jane` | the user |
| `email` | `jane@…` (may be blank) | the user |
| `message` | free text | the user |
| `timestamp` | date/time | Worker |
| `notes` | `` (empty) | you, later, in the admin dashboard |
| `closureCode` | `fixed` or null | Worker, when status → `resolved` (required — see below) |
| `closureNote` | `was a stale localStorage key` or null | you, when resolving (optional free text, ≤500 chars) |
| `resolvedAt` | date/time or null | Worker, when status → `resolved` (starts the auto-close clock) |
| `closedAt` | date/time or null | Worker, when the ticket closes |
| `autoClosed` | `true` / `false` / null | Worker (`true` = closed by the 7-day sweep) |

There's also a tiny `counters/{trigram}` document per app that just holds the last-used number, so each app gets its own clean sequence (`WDA-0001`, `WDA-0002`, …) independent of every other app.

---

## The ticket lifecycle (statuses)

Five statuses, in workflow order. The canonical list lives in one place —
[`lib/status.ts`](../lib/status.ts) — which both the Worker and the admin
dashboard import, so the backend and the UI can't drift.

| Status | Meaning |
|---|---|
| `new` | Just landed, not looked at yet. Every submission starts here. |
| `in-progress` | Being worked on. Shown as **work in progress**. |
| `pending` | Parked, waiting on someone or something else (a reply, an upstream fix). |
| `resolved` | Believed fixed/answered. Still visible, still reopenable. |
| `closed` | Done and settled. **Set automatically, never by hand.** |

```
new ──▶ in-progress ──▶ resolved ──(7 days)──▶ closed
          ▲     │                     │
          └─ pending ◀────────────────┘  (reopening clears the clock)
```

**The `open` view = anything that isn't `resolved` or `closed`** — i.e. `new` +
`in-progress` + `pending`. It's what the dashboard lands on, and it's the
"still on my plate" list. `open` is a *bucket*, not a status; nothing is ever
stored with a status of `open`.

### Closure codes and notes — *why* a ticket ended

Resolving a ticket always says why, in two parts:

- **`closureCode`** — one of a fixed set (below). Required. It's the sortable,
  filterable answer to "what happens to feedback?", shown in the dashboard's
  **CLOSURE** column.
- **`closureNote`** — optional free text (≤500 chars) for the specifics: *"was
  a stale localStorage key"*, *"already covered by WDA-0007"*, *"single-player
  by design; netcode is a whole other project"*. This is the bit that makes
  sense of a ticket six months later. It's separate from `notes` (working
  scratchpad) — the closure note is the *record of how it ended*.

The codes, which carry through to `closed`:

| Code | Use it when |
|---|---|
| `fixed` | it was broken, now it works |
| `implemented` | the requested thing was built or added |
| `answered` | a question or comment answered — nothing to change |
| `wont-fix` | real, understood, deliberately not doing it |
| `duplicate` | already covered by another ticket |
| `cannot-reproduce` | couldn't make it happen; nothing to fix |
| `spam` | not a genuine submission |
| `unspecified` | **not selectable** — backfilled onto tickets resolved before codes existed |

The Worker **requires** a code in the same request that sets `resolved`, so a
finished ticket can't exist with no explanation. In the dashboard, choosing
"resolved" therefore doesn't save immediately: it arms a code picker and a note
box next to the status, and all three are sent together when you confirm
(`RESOLVE →`, disabled until a code is chosen — the note stays optional). The
bulk bar works the same way, minus the note: a "resolve as…" picker rather than
a plain button, since a note is per-ticket.

Afterwards the code and the note can each be corrected on their own (a
`closureCode`- or `closureNote`-only PATCH), which does **not** touch the status
or restart the auto-close clock. Reopening a ticket clears both, since they no
longer apply.

This is also where the retired `wont-fix` *status* went: it was never really a
state, it was a reason. Old `wont-fix` records keep that meaning — the sweep
migrates them to `closed` with `closureCode: wont-fix`.

### Auto-close after 7 days

You can't mark a ticket `closed` yourself — the dashboard doesn't offer it and
the Worker rejects `{"status":"closed"}` with a 400. Instead you mark it
`resolved`, which stamps `resolvedAt`, and it closes itself **7 days later**.
That week is deliberate: it leaves time to test the fix, and for a submitter to
come back and say it's still broken. Moving a ticket back to `new` /
`in-progress` / `pending` before then clears `resolvedAt`, so a reopened ticket
never closes on a stale timer.

The window is one constant — `AUTO_CLOSE_DAYS` in `lib/status.ts`.

Two things run the sweep (`worker/src/sweep.ts`), sharing one implementation so
a ticket can't be closed twice:

- **`GET /admin/submissions`** sweeps the list it just fetched before returning
  it, so the dashboard never shows a ticket that should already have closed. No
  extra reads, and no writes at all unless something is due.
- **A nightly Cloudflare cron** (03:30 UTC, `[triggers]` in `wrangler.toml`) does
  the same, so closing doesn't depend on anyone opening the dashboard.

The same sweep rewrites records from the pre-redesign four-status system
(`open` → `new`, `done` → `resolved`, `wont-fix` → `closed`) the first time it
sees them, so no manual migration was needed. A legacy `done` gets its 7-day
clock started at that moment rather than closing instantly, and picks up
`closureCode: unspecified`; a legacy `wont-fix` keeps its meaning as
`closureCode: wont-fix`. Tickets that migrate to `new` stay codeless — only a
finished ticket carries a closure code.

---

## Deploying the Worker

**The Worker deploys itself.** `.github/workflows/deploy-worker.yml` runs
`wrangler deploy` whenever a push to `main` touches `worker/**` or `lib/**` — so
it can't silently fall behind the Pages site, which has always deployed on push.
That workflow is also what registers the `[triggers]` cron from `wrangler.toml`.

Nothing here needs a terminal, which means the whole loop works from a phone:

| To do this | Do it here |
|---|---|
| Deploy the current `main` | happens on merge, or **Actions → Deploy Worker → Run workflow** |
| Check it worked | the run's summary line, or ask Claude Code |
| Validate without deploying | Run workflow with **dry run** ticked |
| Change a Worker secret | Cloudflare dashboard → Workers & Pages → `benjuicey-feedback` → Settings → Variables (encrypt it) |
| Change `ALLOWED_ORIGINS` / cron | edit `worker/wrangler.toml`, merge — the deploy follows |

Setting up the one secret it needs (a browser, phone or laptop, is enough):

1. Cloudflare → **My Profile → API Tokens → Create Token →** use the **Edit
   Cloudflare Workers** template. Copy the token.
2. GitHub → this repo → **Settings → Secrets and variables → Actions → New
   repository secret**, named `CLOUDFLARE_API_TOKEN`. (Use the browser — the
   GitHub mobile app can't add secrets or dispatch workflows.)
3. Only if that token can see more than one Cloudflare account, add
   `CLOUDFLARE_ACCOUNT_ID` the same way. Otherwise it's inferred.

The token lets the workflow deploy code. It does **not** touch the Worker's own
secrets (`GOOGLE_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `ADMIN_PASSWORD`) —
those live in Cloudflare and a deploy leaves them exactly as they are.

By hand from a laptop, if you'd rather: `cd worker && npx wrangler deploy` (needs
`npx wrangler login` once).

> **Deploy order matters a little.** The Worker validates statuses, so a *new*
> Worker with an *old* dashboard rejects the statuses that dashboard sends, and
> an *old* Worker with a *new* dashboard silently drops fields it doesn't know.
> Neither loses data, but keep the gap short — merging Worker and dashboard
> changes together does that automatically.

---

## Emails & notifications

Notifications go through **Resend**, an email API built for server-side sending. It's best-effort: a send failure never blocks a submission that's already saved to Firestore.

> ⚠️ **Why not Formspree?** We tried it first (the zero-setup path) and retired it. Because the browser never talks to Formspree here — the *Worker* POSTs to it server-side, from a Cloudflare datacenter IP — Formspree's spam filter files every notification under **Spam** and never emails you. Realistic content and "Not Spam" training didn't fix it; the datacenter-origin signal dominates. Formspree is built for a browser posting *directly* to it, so it's the wrong tool for this server-side fan-out. Full write-up in the DEVLOG (2026-07-14 session 2). Resend doesn't spam-score your own mail, so it's the supported path.

- **Admin notification (Resend).** If a `RESEND_API_KEY` secret is set (a real `re_…` key — the code ignores placeholders), the Worker emails `ADMIN_EMAIL` a formatted HTML summary directly (`sendAdminNotification`). In test mode the `onboarding@resend.dev` sender can only deliver to your own Resend-account address, so `ADMIN_EMAIL` must match it — which needs **no domain verification** for notifications to yourself.
- **Confirmation email to the submitter** (`sendConfirmation`, Resend) — a "got your message, ref WDA-0001" reply, sent only if they left an email. Needs a **verified domain** on Resend (the `onboarding@resend.dev` test sender can't email arbitrary recipients), so it stays off until that's done.
- **No spam/rate limiting yet.** Anyone can POST to `/submit`. Fine at current volume; if abused, add Cloudflare rate limiting or Turnstile in front of the Worker.

### Turning email on (Resend)

1. Create a [Resend](https://resend.com) account. **Sign up with the email you want notifications to land in** (`benjuice.apps@gmail.com` — it already matches `ADMIN_EMAIL`) — in test mode the `onboarding@resend.dev` sender can only deliver to that account's own address.
2. Grab an API key (starts with `re_`) and set it as the Worker secret — either in the Cloudflare dashboard (Workers & Pages → `benjuicey-feedback` → Settings → Variables → add `RESEND_API_KEY`, **encrypt**; works from a phone) or with `cd worker && npx wrangler secret put RESEND_API_KEY`. Secrets take effect immediately; no redeploy needed.
3. Submit a test — the admin notification should land with no spam filtering. To also send **confirmation emails to submitters**, verify a domain on Resend and change the `from:` address in `email.ts` off `onboarding@resend.dev`.

Until this is done, feedback still saves fine — you just read it in the admin dashboard, and the "ask Claude to categorise" workflow below is the way to stay on top of it.

---

## How to review feedback

### Option A — the admin dashboard (normal use)

The portfolio site has a private admin page: **`https://benjuicey-apps.pages.dev/admin`** (also on the live portfolio domain). Enter the admin password and you get:

- Every submission from every app in one list, newest first
- Stat tiles: total / open / new / work in progress / pending / resolved — each tile is also a shortcut to that view
- Views: **all**, **open** (the default — everything not resolved or closed), then one per status
- Wildcard filters and click-to-sort on every column, plus multi-select for bulk status changes
- Click any item to read the full message, change its **status** and **closure code**, and add private **internal notes**
- A `resolved` ticket shows how long until it auto-closes (`·4d` in the table, spelled out in the detail panel). `closed` isn't offered as a choice — see the lifecycle above.
- The **CLOSURE** column shows why each finished ticket ended (`—` while it's still open), so `*won't*` in that column's filter is "everything I decided not to do". Hover a cell for the closure note.

That's the whole management surface — it reads and writes through the Worker's admin endpoints.

### Option B — the API (for Claude / automation)

The same data is available over HTTP, password-protected via the `x-admin-password` header:

```bash
# List every submission (newest first)
curl https://benjuicey-feedback.benjuicemcjuice.workers.dev/admin/submissions \
  -H "x-admin-password: YOUR_ADMIN_PASSWORD"

# Update one item's status and/or notes
curl -X PATCH https://benjuicey-feedback.benjuicemcjuice.workers.dev/admin/submissions/WDA-0001 \
  -H "x-admin-password: YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"status":"in-progress","notes":"triaged: real bug, assigned to next sprint"}'
```

`status` accepts only `new`, `in-progress`, `pending`, `resolved`. Anything else
— including `closed` and the retired `open` / `done` / `wont-fix` — gets a 400
with an explanation. Setting `resolved` returns the `resolvedAt` it stamped, so
a caller can work out the auto-close date without a second request.

**Resolving must include a closure code** in the same request, or it's a 400:

```bash
# Resolve, saying why (closureNote optional, trimmed and capped at 500 chars)
curl -X PATCH .../admin/submissions/WDA-0001 \
  -H "x-admin-password: YOUR_ADMIN_PASSWORD" -H "Content-Type: application/json" \
  -d '{"status":"resolved","closureCode":"fixed","closureNote":"was a stale localStorage key"}'

# Correct just the code or note later — status and the clock are untouched
curl -X PATCH .../admin/submissions/WDA-0001 \
  -H "x-admin-password: YOUR_ADMIN_PASSWORD" -H "Content-Type: application/json" \
  -d '{"closureNote":"was a stale localStorage key, cleared on version bump"}'
```

> **The admin password is a secret.** It lives only as the `ADMIN_PASSWORD` secret in Cloudflare. Do not commit it to any repo. Provide it to Claude at the moment you ask for a triage run; Claude does not and should not store it.

---

## Asking Claude to categorise / triage new feedback

This is the workflow for "read the newer updates and categorise them" — either on demand or on a schedule.

### What Claude does

1. **Pull** the submissions via `GET /admin/submissions` (you provide the admin password for that run).
2. **Focus on what's new** — e.g. everything with `status: "new"` (or the whole open bucket: `new` + `in-progress` + `pending`), or everything since a date/ref you name.
3. **Categorise & triage**, going beyond the coarse `type` the user picked:
   - group by app and by theme (e.g. "3 apps have a dark-mode request")
   - flag likely duplicates
   - suggest a priority (volume + recency + severity)
   - surface anything urgent or from a named partner
   - give a per-app summary
4. **Optionally write back** — set `status` (e.g. `new` → `in-progress`) and drop a triage tag into `notes` via `PATCH`, so the dashboard reflects the review.

### A ready-to-use prompt

> "Pull all feedback from the shared Worker admin endpoint (password: `<paste>`), look at everything still open (`new` / `in-progress` / `pending`), and categorise it: group by theme and app, flag duplicates and anything urgent, and give me a prioritised list of what to act on. Don't write anything back yet — just show me the summary."

Then, if you like the triage: "Now mark items 1–4 as `in-progress` and add a one-line triage note to each."

### On a schedule

You can have this run automatically (say, every Monday morning) so a categorised digest is waiting for you. Ask Claude to "schedule a weekly feedback triage" — it sets up a recurring task that pulls new submissions and produces the categorised summary. Two practical notes:

- The scheduled run needs the admin password available to it (as a secret in that task's environment) — it can't prompt you each time. Never put the password in a repo.
- This manual/scheduled Claude approach is the interim version of the planned **"AI Analysis" button** in the admin dashboard (`docs/backlog.md`, Epic 4), which will do the same thing on-demand from the UI via the Claude API.

---

## Where the code lives

| Piece | Location |
|---|---|
| Submit + admin endpoints | `worker/src/index.ts` |
| Ref numbering + Firestore reads/writes | `worker/src/firestore.ts` |
| Trigram registry (appId → trigram, app names) | `worker/src/trigrams.ts` |
| Notification + confirmation emails (Resend) | `worker/src/email.ts` |
| Allowed origins (CORS) + config | `worker/wrangler.toml` |
| Embeddable widget served at `/widget.js` | `worker/src/widget.ts` |
| Admin dashboard UI | `app/admin/page.tsx` |
| Portfolio's own contact form | `app/contact/page.tsx` |
| Database security rules | `firestore.rules` |
