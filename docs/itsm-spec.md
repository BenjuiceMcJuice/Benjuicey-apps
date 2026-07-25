# ITSM Backend — ITIL-Aligned Service Desk (Spec / Design)

**Status: proposed design, not built yet.** This is the forward plan for evolving
today's single-collection feedback system into a lightweight, ITIL-aligned ITSM
backend with a **Service Desk** triage function. It is deliberately incremental —
every phase keeps the existing feedback pipeline working and adds structure on top.

> Companion docs: [`feedback-standard.md`](feedback-standard.md) (the current schema
> and rules) and [`feedback-how-it-works.md`](feedback-how-it-works.md) (the current
> end-to-end flow, including the existing "ask Claude to triage" workflow this spec
> formalises). This document supersedes neither yet — it describes where they're heading.

---

## 1. Why

Right now every inbound item — bug report, feature idea, "just saying hi" — lands
in one flat `submissions` collection with a coarse `type` (`bug` / `content` /
`request` / `general`) and a single `status` lifecycle (`new` / `in-progress` /
`pending` / `resolved` / `closed` — built since this spec was written, see §6.3).
That's fine for a feedback inbox. It is **not** a service-management
process: there's no separation between "something is broken" (an **incident**) and
"please add a thing" (a **service request**), no concept of a recurring root cause
(a **problem**), no priority derived from impact and urgency, and no defined
lifecycle per record type.

The goal is to introduce just enough ITIL to make the queue behave like a real
ITSM tool — a **Service Desk that triages each item into the right process** — while
staying a one-person, one-Worker, one-Firestore operation. No enterprise bloat:
ITIL as a *shaping vocabulary*, not a compliance regime.

### Scope guard

Per [`CLAUDE.md`](../CLAUDE.md), only apps live on the portfolio (`data/categories.ts`)
count: **BetaLog, What a Disaster, AI-Literate, Dungeon of Montor**, plus the
portfolio itself (`BEJ`). The ITSM backend is app-agnostic (it keys off `appId`/
trigram like feedback does), so it needs no per-app wiring — but SLAs, dashboards
and "affected service" reporting should only surface live apps.

---

## 2. ITIL concepts, mapped to this platform

We adopt a small subset of ITIL 4 practices and translate each to something that
already exists (or is a thin add) here.

| ITIL practice / concept | What it means here | Backed by |
|---|---|---|
| **Service Desk** (function) | The single point of contact — every app's feedback widget + the portfolio contact form already funnel to one Worker. That funnel **is** the Service Desk intake. | `worker/src/index.ts` `POST /submit` |
| **Triage** | Classifying each raw submission into a record type + priority. Today: manual/Claude. Target: AI-assisted, human-confirmed. | new `triage` step (§6) |
| **Incident Management** | Restore normal service — "something is broken". | `recordType: incident` |
| **Service Request Management** | Fulfil a defined, low-risk request — "please add / change / give me X". | `recordType: request` |
| **Problem Management** | Find the root cause behind repeated incidents. | `recordType: problem` (links incidents) |
| **Change Enablement** | Track the actual change made to resolve a request/problem (lightweight, since Ben is the only implementer). | `recordType: change` (optional, phase 3+) |
| **Service Catalogue** | The list of live apps = the services under management. | `data/categories.ts` + `trigrams.ts` |
| **Priority = Impact × Urgency** | A derived P1–P4, not a free-form guess. | `impact` + `urgency` → `priority` (§8) |
| **SLA / targets** | Response + resolution targets per priority. Advisory, not contractual. | `sla` fields (§8) |
| **CMDB / Configuration Items** | Overkill for now. The "CI" is just the app (`appId`). Explicitly out of scope. | — |

### The one-line model

> The **Service Desk** (the shared Worker) receives every submission, **triage**
> turns it into a typed **record** (incident / request / problem / query / change),
> assigns a **priority** from impact × urgency, and moves it through a lifecycle
> until it's **resolved** and **closed** — with **Claude** doing the first-pass
> classification.

---

## 3. Record types (the triage taxonomy)

Every submission becomes exactly one record with a `recordType`. This is the
heart of the Service Desk function — routing "tickets / feedback / etc into the
respective process".

| `recordType` | ITIL process | Definition | Typical source `type` |
|---|---|---|---|
| `incident` | Incident Mgmt | Unplanned interruption or quality drop in a live service — it's broken, wrong, or degraded. | `bug`, some `content` |
| `request` | Service Request Mgmt | A wanted addition or change that isn't a fault — a feature, new content, an enhancement. | `request`, some `content` |
| `query` | Service Desk | A question or general comment needing a reply, not a change — "how do I…", "just saying hi". | `general` |
| `problem` | Problem Mgmt | The underlying root cause behind one or more incidents. **Created by triage, never by a submitter.** | derived |
| `change` | Change Enablement | The concrete piece of work done to resolve a request/problem (optional record; can stay implicit early on). | derived |

### Default mapping from today's `type`

The existing canonical categories seed the triage, so nothing has to be
re-classified from scratch:

```
bug      → incident        (default; escalate to problem if it recurs)
content  → incident        if it's wrong/broken content (accuracy)
         → request         if it's a "please add/reword" ask (enhancement)
request  → request
general  → query           (or close as informational)
```

Triage can always override the default — that's the point of triage. The raw
`type` the user picked is **retained** as `sourceType` for audit.

---

## 4. The Service Desk triage flow

```
Submission lands (POST /submit)
        │  recordType: unset, status: "new", sourceType kept
        ▼
┌─────────────────────────────────────────────┐
│  SERVICE DESK TRIAGE                          │
│  (Claude first-pass → Ben confirms)           │
│                                               │
│  1. Is it a real, actionable item?            │
│       no  → recordType: query / close (spam,  │
│             thanks, duplicate)                 │
│       yes → continue                          │
│  2. Broken vs wanted?                          │
│       broken  → incident                       │
│       wanted  → request                        │
│       asking  → query                           │
│  3. Set impact + urgency → priority (P1–P4)    │
│  4. Duplicate of an open record? → link/merge  │
│  5. Pattern across ≥2 incidents? → open/attach │
│       a problem                                 │
└─────────────────────────────────────────────┘
        │
        ▼
Typed record enters the right queue with a lifecycle (§7)
```

Triage is the only place records are *created from* raw submissions and the only
place `recordType` / `priority` are first set. Everything downstream is lifecycle
management within a type.

---

## 5. Prioritisation

Priority is **derived**, ITIL-style, from an impact × urgency matrix — so it's
consistent, not vibes.

- **Impact** — how much of the service / how many users are affected: `high` /
  `medium` / `low`. (For a solo portfolio: `high` ≈ app broken for everyone,
  `low` ≈ cosmetic / one user.)
- **Urgency** — how quickly it needs attention: `high` / `medium` / `low`.

| Impact ↓ / Urgency → | High | Medium | Low |
|---|---|---|---|
| **High** | P1 | P2 | P3 |
| **Medium** | P2 | P3 | P3 |
| **Low** | P3 | P3 | P4 |

Advisory **targets** (not contractual — this is a hobby platform, but useful for
sorting the queue and for the AI digest to flag "overdue"):

| Priority | Respond within | Resolve target |
|---|---|---|
| P1 | same day | 2 days |
| P2 | 2 days | 1 week |
| P3 | 1 week | best-effort |
| P4 | — | backlog |

`query` records don't get a priority — they get a "needs reply" flag and are
closed on answer. `request` records use the same matrix but urgency usually
skews low (they're wants, not breakages).

---

## 6. Data model evolution

The current document (`submissions/{ref}`) stays valid — new fields are **added**
and default sensibly, so old records and the existing Worker keep working. No
migration is forced; a lazy backfill during triage is enough.

### New / changed fields on a ticket

| Field | Type | Default | Notes |
|---|---|---|---|
| `recordType` | string | `null` (untriaged) | `incident` / `request` / `query` / `problem` / `change` |
| `sourceType` | string | copy of `type` | the raw category the submitter picked (audit) |
| `impact` | string | `null` | `high` / `medium` / `low` |
| `urgency` | string | `null` | `high` / `medium` / `low` |
| `priority` | string | `null` | derived `P1`–`P4` |
| `triage` | map | `null` | `{ by: "claude" \| "ben", at, confidence, rationale }` |
| `linkedTo` | array | `[]` | refs of related records (duplicate-of, caused-by-problem) |
| `problemRef` | string | `null` | the parent problem, if this incident is attached to one |
| `slaDueAt` | timestamp | `null` | computed from `priority` + `timestamp` |
| `assignee` | string | `"ben"` | single implementer today; kept for future |
| `resolvedAt` | timestamp | `null` | ✅ **built** — set when status → `resolved` |
| `closureCode` | string | `null` | ✅ **built** — *why* it ended; required to resolve (§6.3) |
| `closureNote` | string | `null` | ✅ **built** — the free-text "what fixed it" line this table originally called `resolution`; optional, ≤500 chars. Feeds a future Change record / KB. |

### 6.3 Status: ✅ built

The lifecycle half of phase 1 shipped ahead of the rest of the spec. The canonical
enum lives in [`lib/status.ts`](../lib/status.ts), imported by both the Worker and
the admin dashboard:

```
new → in-progress → resolved → closed
        ↕
      pending
```

- **`open` is a view, not a status** — it means "anything not `resolved` or
  `closed`" (`new` + `in-progress` + `pending`), and it's what the dashboard
  lands on.
- **`closed` is not settable.** `PATCH /admin/submissions/:ref` rejects it; a
  ticket is marked `resolved` (which stamps `resolvedAt`) and auto-closes 7 days
  later, leaving a window to test the fix. Reopening clears the clock.
- **Resolving carries a closure code** (`fixed` / `implemented` / `answered` /
  `wont-fix` / `duplicate` / `cannot-reproduce` / `spam`), required by the
  Worker in the same request, plus an optional free-text `closureNote`. This is
  the ITIL *resolution code* (and resolution text), and it's where the old
  `wont-fix` status belongs — a reason, not a state.
- The old four values were migrated in place by the same sweep that auto-closes
  (`worker/src/sweep.ts`): `open` → `new`, `done` → `resolved` (code
  `unspecified`), `wont-fix` → `closed` (code `wont-fix`). Nothing stores them
  any more.

Full write-up: [`feedback-how-it-works.md`](feedback-how-it-works.md) →
"The ticket lifecycle".

What this spec still adds on top: **per-`recordType`** state sets (§7), so the UI
offers only the states valid for an incident vs a request vs a query.

### Collections

- Keep `submissions/{ref}` as the record store (rename conceptually to "tickets";
  no need to actually rename the collection). Per-app trigram ref numbering is
  unchanged (`WDA-0001`).
- Add `problems/{PRB-000n}` for problem records (their own counter, trigram `PRB`
  or a global `PRB` sequence — decision in §11).
- No CMDB collection. The service catalogue is `data/categories.ts`.

---

## 7. Lifecycles (status workflows per record type)

**Incident**

```
new → triaged → in-progress → resolved → closed
                     │
                     └→ (recurring?) attach to a problem
      any → closed (duplicate / not-reproducible / wont-fix)
```

**Service request**

```
new → triaged → approved → in-progress → fulfilled(resolved) → closed
                    │
                    └→ rejected/closed (out of scope, wont-do)
```

**Query**

```
new → answered → closed        (no priority; "needs reply" flag until answered)
```

**Problem** (created by triage, links incidents)

```
open → investigating → known-error(workaround) → resolved → closed
```

A single canonical `status` enum covers all of these; the UI shows only the
states valid for the row's `recordType`.

> **Where this stands:** the shared spine — `new` → `in-progress` / `pending` →
> `resolved` → `closed` — is built (§6.3) and applies to every ticket regardless
> of type. The type-specific extras above (`triaged`, `approved`, `answered`,
> `investigating`, `known-error`) are still proposed, and arrive with
> `recordType`. `wont-fix` is gone as a *state*: a won't-do item is `resolved`
> with `closureCode: wont-fix`, and closes itself like anything else.

---

## 8. Where the logic lives (Worker + UI changes)

Grounded in the real stack — these are additive endpoints/fields, not a rewrite.

**Worker (`worker/src/`)**
- `POST /submit` — unchanged for callers; internally stamps `recordType: null`,
  `sourceType: type`, `status: "new"`.
- New `PATCH /admin/submissions/:ref` fields — accept `recordType`, `impact`,
  `urgency`, `priority`, `triage`, `linkedTo`, `problemRef`, `assignee`.
  `updateSubmission` in `firestore.ts` now takes a typed field bag (`status`,
  `notes`, `closureCode`, `closureNote`, `resolvedAt`, `closedAt`, `autoClosed`)
  with a generic value encoder, so adding these is a matter of widening one
  interface.
- New `POST /admin/triage` (batch) — accept an array of `{ ref, recordType,
  impact, urgency, triage }` so a triage run can write many records in one call.
- New `problems` CRUD (mirror submissions) — phase 3.
- Priority + `slaDueAt` can be computed server-side from `impact`/`urgency` so the
  matrix lives in one place.

**Admin dashboard (`app/admin/page.tsx`)** — builds on the new technical fault
table:
- Add columns/filters for `recordType`, `priority`, `assignee`, `slaDueAt`
  (all wildcard-filterable like the rest).
- **Queue presets** beside the status presets: *Untriaged* (`recordType` empty),
  *Incidents*, *Requests*, *Queries*, *Problems*, *Overdue* (`slaDueAt` < now).
  Default stays **open** tickets.
- A **triage panel** in the expanded row: set recordType / impact / urgency,
  see the derived priority, link a duplicate, attach to a problem.
- An **"AI triage"** action (Epic 4 in [`backlog.md`](backlog.md)) that calls the
  Claude API to propose the triage fields and pre-fills them for Ben to confirm.

---

## 9. The AI triage engine (phased)

The AI is the Service Desk analyst doing the **first-pass classification**; Ben
(or later, auto-apply rules) confirms. Three phases, matching the request:
"initially me manually asking Claude Code… but maybe later a scheduled task or a
trigger based on a new item".

### Phase A — Manual, on-demand (today, formalised)

Exactly the workflow already documented in `feedback-how-it-works.md` §"Asking
Claude to categorise", but producing **triage records**, not just a summary.

- Ben asks Claude Code to run a triage. Claude:
  1. `GET /admin/submissions` (Ben supplies the admin password for that run — never
     stored, never committed).
  2. Filter to `status: "new"` / untriaged.
  3. For each: propose `recordType`, `impact`, `urgency` (→ `priority`), flag
     duplicates, and spot cross-app patterns worth a **problem** record.
  4. Present the proposal for Ben's confirmation.
  5. On approval, write back via `PATCH` / the new `POST /admin/triage`.
- **Deliverable of this spec's phase A:** a repeatable prompt + the write-back
  fields. No infra needed beyond extending `updateSubmission`.

> Ready-to-use prompt (evolution of the existing one):
> *"Pull all `new`/untriaged submissions from the Worker admin endpoint
> (password: `<paste>`). For each, classify it as incident / request / query,
> set impact and urgency (so priority derives P1–P4), flag duplicates, and tell
> me if any cluster of incidents should become a problem. Show me the proposed
> triage table first — don't write anything back until I confirm."*

### Phase B — Scheduled triage (a cron/Routine)

Same logic, unattended, on a schedule (e.g. every morning / every Monday).

- A **scheduled task** (Claude Code Routine / cron — see `create_trigger` /
  `send_later`, or a Cloudflare Cron Trigger on the Worker) fires a triage run.
- It needs the admin password available **as a secret in the task's environment**
  — it can't prompt. (Same constraint already noted in `feedback-how-it-works.md`.)
- Two safety modes:
  - **Propose-only (recommended first):** writes a categorised digest / draft
    triage to `notes` or emails it (Resend), leaves `status: "new"`. Ben confirms
    in the dashboard.
  - **Auto-apply (later, once trusted):** writes `recordType` + `priority`
    directly, but only for **high-confidence** classifications; low-confidence ones
    stay untriaged for human review. `triage.confidence` gates this.

### Phase C — Trigger on new item (event-driven)

Triage the moment a submission lands, instead of waiting for a schedule.

- Cleanest hook: the Worker already handles `POST /submit` and already fires a
  best-effort Resend notification in that same request. Add an **async triage
  call** in the same spot (`ctx.waitUntil`, so it never blocks or fails the save):
  1. submission saved to Firestore (source of truth — unchanged), then
  2. fire-and-forget call to the Claude API (or enqueue to a Cloudflare Queue) to
     classify it, then
  3. `PATCH` the record with the proposed triage (propose-only or gated
     auto-apply, same as phase B).
- Keeps the platform's existing rule: **the save is the source of truth; the
  AI/email steps are best-effort and never block a saved submission.**
- Alternative: a **Firestore trigger** (Cloud Function) on new `submissions` docs.
  Heavier (adds GCP Functions to the stack) — prefer the Worker `waitUntil` path
  to stay on the current Cloudflare + Claude API footprint.

### Confidence & human-in-the-loop

Across all phases, every AI triage carries `triage.confidence` and
`triage.rationale`. Ben stays the approver until auto-apply has earned trust; the
dashboard always shows *who* triaged (`claude` vs `ben`) so nothing is a black box.

---

## 10. Phased rollout

| Phase | Deliverable | Depends on |
|---|---|---|
| **0** | ✅ Technical fault table in `/admin` (columns, wildcard filters, default = open). | done |
| **0.5** | ✅ Status lifecycle (`new`/`in-progress`/`pending`/`resolved`/`closed`), `open` as a view, 7-day auto-close + legacy migration sweep, closure codes + notes on resolve, widened `updateSubmission`. | done |
| **1** | Add `recordType` + `sourceType` to the schema; per-type state sets; queue presets + triage panel in the UI. | phase 0.5 |
| **2** | Impact/urgency → priority + `slaDueAt` (server-computed); *Overdue* queue. | phase 1 |
| **3** | `problem` records + linking; duplicate linking. | phase 1 |
| **4A** | Formal **manual Claude triage** run + write-back (`POST /admin/triage`). | phase 1 |
| **4B** | **Scheduled** triage (propose-only digest). | 4A |
| **4C** | **Trigger-on-new** triage via Worker `waitUntil` + Claude API; gated auto-apply. | 4A/4B |
| **5** | `closureNote` → lightweight `change` records + a tiny known-error/KB view. | phase 3 |

Each phase is independently shippable and leaves the feedback pipeline intact.

---

## 11. Open decisions for Ben

1. **Problem ref scheme** — global `PRB-000n`, or per-app? (Problems can span apps,
   so a single global `PRB` sequence is probably cleanest.)
2. **Auto-apply threshold** — do we ever let AI set `recordType`/`priority` without
   confirmation, and at what `confidence`? (Recommend: propose-only until a few
   weeks of manual runs show the classifier is reliable.)
3. **Where the scheduled/triggered triage calls Claude** — Claude Code Routine
   (simplest, reuses this setup) vs a Worker→Claude API call (tighter, event-driven,
   no external scheduler). Recommend Worker `waitUntil` for phase C, a Routine for
   phase B.
4. **Query handling** — do `query` records deserve their own answered/closed flow in
   the UI, or just close-with-a-note? (Low volume; a note is probably enough at first.)
5. **SLA visibility** — targets are advisory here; is an *Overdue* flag useful, or
   noise for a solo hobby platform? (Cheap to add, easy to ignore — lean yes.)

---

## 12. What this is **not**

To keep it honest and small: no CMDB, no asset management, no multi-agent /
approval chains, no per-customer SLAs, no change advisory board. ITIL is used here
as a **classification and lifecycle vocabulary** to make one person's feedback
queue behave like a proper service desk — not as a framework to implement wholesale.
