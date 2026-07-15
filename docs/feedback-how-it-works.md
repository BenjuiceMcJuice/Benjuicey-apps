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
| `status` | `open` | Worker (always starts `open`) |
| `name` | `Jane` | the user |
| `email` | `jane@…` (may be blank) | the user |
| `message` | free text | the user |
| `timestamp` | date/time | Worker |
| `notes` | `` (empty) | you, later, in the admin dashboard |

There's also a tiny `counters/{trigram}` document per app that just holds the last-used number, so each app gets its own clean sequence (`WDA-0001`, `WDA-0002`, …) independent of every other app.

---

## Emails & notifications

Notifications go through **Resend**, an email API built for server-side sending. It's best-effort: a send failure never blocks a submission that's already saved to Firestore.

> ⚠️ **Why not Formspree?** We tried it first (the zero-setup path) and retired it. Because the browser never talks to Formspree here — the *Worker* POSTs to it server-side, from a Cloudflare datacenter IP — Formspree's spam filter files every notification under **Spam** and never emails you. Realistic content and "Not Spam" training didn't fix it; the datacenter-origin signal dominates. Formspree is built for a browser posting *directly* to it, so it's the wrong tool for this server-side fan-out. Full write-up in the DEVLOG (2026-07-14 session 2). Resend doesn't spam-score your own mail, so it's the supported path.

- **Admin notification (Resend).** If a `RESEND_API_KEY` secret is set (a real `re_…` key — the code ignores placeholders), the Worker emails `ADMIN_EMAIL` a formatted HTML summary directly (`sendAdminNotification`). In test mode the `onboarding@resend.dev` sender can only deliver to your own Resend-account address, so `ADMIN_EMAIL` must match it — which needs **no domain verification** for notifications to yourself.
- **Per-app extra notifiers (e.g. Heather for What a Disaster).** Some apps have a second person who should get the feedback. Set that app's env var — for What a Disaster it's `WDA_NOTIFY_EMAIL` (`worker/wrangler.toml`, or a Cloudflare secret to keep the address private) — and the Worker **CC**s them on the admin notification and adds a "🔔 *Heather* has also been notified of this What a Disaster feedback" line, so everyone reading the email can see they're in the loop. The submitter's confirmation email gets the same "…has also been notified" note. Only What a Disaster feedback triggers this; leave the var empty to notify only Ben. **⚠️ Delivery caveat:** while Resend is in test mode (`onboarding@resend.dev` sender), Resend only delivers to the account owner's address, so the CC to Heather is dropped by Resend until a **domain is verified** on Resend. The routing is live; delivery to Heather waits on that one step.
- **Confirmation email to the submitter** (`sendConfirmation`, Resend) — a "got your message, ref WDA-0001" reply, sent only if they left an email. Needs a **verified domain** on Resend (the `onboarding@resend.dev` test sender can't email arbitrary recipients), so it stays off until that's done.
- **No spam/rate limiting yet.** Anyone can POST to `/submit`. Fine at current volume; if abused, add Cloudflare rate limiting or Turnstile in front of the Worker.

### Turning email on (Resend)

1. Create a [Resend](https://resend.com) account. **Sign up with the email you want notifications to land in** (`benjuice.apps@gmail.com` — it already matches `ADMIN_EMAIL`) — in test mode the `onboarding@resend.dev` sender can only deliver to that account's own address.
2. Grab an API key (starts with `re_`) and set it as the Worker secret: `cd worker && npx wrangler secret put RESEND_API_KEY` (paste the key), then `npx wrangler deploy`.
3. Submit a test — the admin notification should land with no spam filtering. To also send **confirmation emails to submitters**, verify a domain on Resend and change the `from:` address in `email.ts` off `onboarding@resend.dev`.

Until this is done, feedback still saves fine — you just read it in the admin dashboard, and the "ask Claude to categorise" workflow below is the way to stay on top of it.

---

## How to review feedback

### Option A — the admin dashboard (normal use)

The portfolio site has a private admin page: **`https://benjuicey-apps.pages.dev/admin`** (also on the live portfolio domain). Enter the admin password and you get:

- Every submission from every app in one list, newest first
- Stat tiles: total / open / in-progress / done
- Filters by status and by app
- Click any item to read the full message, change its **status** (`open` → `in-progress` → `done` / `wont-fix`), and add private **internal notes**

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

> **The admin password is a secret.** It lives only as the `ADMIN_PASSWORD` secret in Cloudflare. Do not commit it to any repo. Provide it to Claude at the moment you ask for a triage run; Claude does not and should not store it.

---

## Asking Claude to categorise / triage new feedback

This is the workflow for "read the newer updates and categorise them" — either on demand or on a schedule.

### What Claude does

1. **Pull** the submissions via `GET /admin/submissions` (you provide the admin password for that run).
2. **Focus on what's new** — e.g. everything with `status: "open"`, or everything since a date/ref you name.
3. **Categorise & triage**, going beyond the coarse `type` the user picked:
   - group by app and by theme (e.g. "3 apps have a dark-mode request")
   - flag likely duplicates
   - suggest a priority (volume + recency + severity)
   - surface anything urgent or from a named partner
   - give a per-app summary
4. **Optionally write back** — set `status` (e.g. `open` → `in-progress`) and drop a triage tag into `notes` via `PATCH`, so the dashboard reflects the review.

### A ready-to-use prompt

> "Pull all feedback from the shared Worker admin endpoint (password: `<paste>`), look at everything still `open`, and categorise it: group by theme and app, flag duplicates and anything urgent, and give me a prioritised list of what to act on. Don't write anything back yet — just show me the summary."

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
