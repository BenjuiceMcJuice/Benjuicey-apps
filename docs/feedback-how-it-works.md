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
        ├──▶ Admin notification email to Ben (Formspree and/or Resend,
        │    whichever is configured — see "Emails & notifications" below)
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

There are **two independent ways** to get a notification email on every new submission. They're separate channels — you can turn on either, both, or neither, and each one is best-effort (a send failure never blocks a submission that's already saved to Firestore).

- **Formspree (easiest — no domain, no secret).** If `FORMSPREE_ENDPOINT` is set in `wrangler.toml`, the Worker POSTs every new submission to your Formspree form (`sendFormspreeNotification` in `worker/src/email.ts`), and Formspree emails you. This is the recommended path because it reuses a Formspree account you already have and needs zero DNS/domain setup.
- **Resend (richer, self-hosted HTML).** If a `RESEND_API_KEY` secret is set, the Worker also emails `ADMIN_EMAIL` a formatted HTML summary directly (`sendAdminNotification`). In Resend test mode the `onboarding@resend.dev` sender can only deliver to your own Resend-account address, so `ADMIN_EMAIL` must match it.
- **Confirmation email to the submitter** (`sendConfirmation`, Resend only) — a "got your message, ref WDA-0001" reply, sent only if they left an email. Needs a **verified domain** on Resend (the `onboarding@resend.dev` test sender can't email arbitrary recipients), so it stays off until that's done.
- **No spam/rate limiting yet.** Anyone can POST to `/submit`. Fine at current volume; if abused, add Cloudflare rate limiting or Turnstile in front of the Worker.

### Turning email on

**Option A — Formspree (do this if you already have an account):**

1. In your [Formspree](https://formspree.io) dashboard, create (or reuse) a form and copy its endpoint — it looks like `https://formspree.io/f/abcdwxyz`. Make sure the form is set to notify the email address you want.
2. Paste it into `worker/wrangler.toml` as `FORMSPREE_ENDPOINT = "https://formspree.io/f/abcdwxyz"`.
3. Redeploy: `cd worker && npx wrangler deploy`. That's it — no secret, no domain verification.

> First-time Formspree gotcha: Formspree usually holds the very first submission to a new form until you click a confirmation link it emails you. Send one test submission, confirm it, and the rest flow through. Free tier caps at ~50 submissions/month.

**Option B — Resend (richer HTML email, or if you'd rather not use Formspree):**

1. Create a [Resend](https://resend.com) account. **Sign up with the email you want notifications to land in** — in test mode the `onboarding@resend.dev` sender can only deliver to that account's own address, which is why `ADMIN_EMAIL` must match it.
2. Grab an API key and set it as the Worker secret: `cd worker && npx wrangler secret put RESEND_API_KEY` (paste the key), then redeploy.
3. Admin notifications to yourself now work. To also send **confirmation emails to submitters**, verify a domain on Resend and change the `from:` address in `email.ts` off `onboarding@resend.dev`.

Until one of these is done, feedback still saves fine — you just read it in the admin dashboard, and the "ask Claude to categorise" workflow below is the way to stay on top of it.

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
| Notification + confirmation emails (Formspree / Resend) | `worker/src/email.ts` |
| Allowed origins (CORS) + config | `worker/wrangler.toml` |
| Embeddable widget served at `/widget.js` | `worker/src/widget.ts` |
| Admin dashboard UI | `app/admin/page.tsx` |
| Portfolio's own contact form | `app/contact/page.tsx` |
| Database security rules | `firestore.rules` |
