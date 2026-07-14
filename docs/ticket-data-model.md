# Ticket Data Model (Spec / Design)

**Status: proposed design, not built yet.** The concrete, field-level data model
for the ITSM backend — the "suitable data model" that [`itsm-spec.md`](itsm-spec.md)
describes at a high level. This doc is the schema of record: ticket types, every
field, the enums, the relationships, and how it stays backwards-compatible with
today's flat `submissions` collection.

> Reading order: [`feedback-standard.md`](feedback-standard.md) (what exists) →
> [`itsm-spec.md`](itsm-spec.md) (the ITIL shape) → **this** (the exact fields).

---

## 1. Principles

1. **Additive, not a rewrite.** Every field below either exists today or is new
   with a safe default. Old records and the current Worker keep working; triage
   backfills the new fields lazily.
2. **One record store.** All ticket types live in one collection (`tickets`, née
   `submissions`) keyed by `ref`. `recordType` distinguishes them. Problems are the
   one exception — they get their own collection because they aggregate tickets.
3. **Raw intent is never lost.** The category the submitter picked is kept as
   `sourceType`; triage may reclassify, but the original is auditable.
4. **Derived fields are derived, not typed by hand.** `priority` comes from
   `impact × urgency`; `slaDueAt` from `priority + createdAt`; `slaBreached` from
   `slaDueAt < now`. Compute them in one place (the Worker) so they can't drift.

---

## 2. Ticket types (`recordType`)

The primary discriminator. One ticket is exactly one type. (Definitions match
`itsm-spec.md` §3 — restated here with their concrete allowed statuses.)

| `recordType` | Meaning | Created by | Valid statuses |
|---|---|---|---|
| `incident` | Broken / degraded / wrong in a live service | submitter → triage | `new` `triaged` `in-progress` `resolved` `closed` |
| `request` | Wanted addition or change (not a fault) | submitter → triage | `new` `triaged` `approved` `in-progress` `fulfilled` `closed` `rejected` |
| `query` | A question / general comment needing a reply | submitter → triage | `new` `answered` `closed` |
| `problem` | Root cause behind ≥1 incident (own collection) | triage only | `open` `investigating` `known-error` `resolved` `closed` |
| `change` | The concrete work done to resolve a request/problem (optional) | triage / on resolve | `planned` `in-progress` `done` `backed-out` |
| `null` | Untriaged — landed but not yet classified | `POST /submit` | `new` |

**Legacy mapping** (so nothing needs re-entering): `bug → incident`,
`content → incident|request`, `request → request`, `general → query`. The old
status values map as in `itsm-spec.md` §6 (`open→new/triaged/in-progress`,
`done→resolved/closed`, `wont-fix→closed`).

---

## 3. The ticket document — `tickets/{ref}`

`ref` is the existing per-app sequential id (`WDA-0001`), unchanged.

### Identity & source
| Field | Type | Req | Default | Set by | Notes |
|---|---|---|---|---|---|
| `ref` | string | ✅ | — | Worker | `TRIGRAM-0001`, per-app sequence |
| `appId` | string | ✅ | — | app | source app; `portfolio` for the site |
| `trigram` | string | ✅ | — | Worker | derived from `appId` |
| `sourceType` | string | ✅ | copy of `type` | Worker | raw category the submitter chose (audit) |
| `recordType` | string | — | `null` | triage | `incident`/`request`/`query`/`problem`/`change` |

### People
| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `name` | string | ✅ | — | submitter's name |
| `email` | string | — | `""` | optional, for reply |
| `assignee` | string | — | `"ben"` | single implementer today; future-proofed |

### Content
| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `subject` | string | — | first ~80 chars of `message` | short title for the table; editable at triage |
| `message` | string | ✅ | — | full free-text body |
| `notes` | string | — | `""` | internal, never shown to submitter |
| `resolution` | string | — | `""` | "what fixed it" — seeds a `change` / KB entry |

### Classification & priority
| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `type` | string | ✅ | — | **legacy** canonical category; kept for back-compat, mirror of `sourceType` |
| `impact` | string | — | `null` | `high`/`medium`/`low` |
| `urgency` | string | — | `null` | `high`/`medium`/`low` |
| `priority` | string | — | `null` | **derived** `P1`–`P4` (impact × urgency, `itsm-spec.md` §5) |
| `tags` | array<string> | — | `[]` | free-form labels (`dark-mode`, `mobile`, `partner`) |

### Lifecycle & timestamps
| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `status` | string | ✅ | `"new"` | unified enum (§4); only type-valid values allowed |
| `createdAt` | timestamp | ✅ | now | replaces/aliases current `timestamp` |
| `triagedAt` | timestamp | — | `null` | when `recordType` first set |
| `resolvedAt` | timestamp | — | `null` | set on → `resolved`/`fulfilled` |
| `closedAt` | timestamp | — | `null` | set on → `closed` |
| `updatedAt` | timestamp | — | `createdAt` | bumped on any write |

### Relationships
| Field | Type | Default | Notes |
|---|---|---|---|
| `duplicateOf` | string | `null` | `ref` this is a duplicate of (closed as dup) |
| `problemRef` | string | `null` | parent `PRB-000n` if attached to a problem |
| `linkedTo` | array<string> | `[]` | other related refs (see-also) |

### Triage & SLA
| Field | Type | Default | Notes |
|---|---|---|---|
| `triage` | map | `null` | `{ by: "claude"\|"ben", at: ts, confidence: 0–1, rationale: string }` |
| `slaDueAt` | timestamp | `null` | **derived** from `priority` + `createdAt` (`itsm-spec.md` §5) |
| `slaBreached` | bool | `false` | **derived** `slaDueAt` < now (compute on read, don't persist stale) |

> **`timestamp` → `createdAt`:** the current field is `timestamp`. Keep writing
> `timestamp` for back-compat and treat `createdAt` as an alias (read either),
> or do a one-time lazy copy on first triage. No hard migration required.

---

## 4. The unified `status` enum

One enum across all types; the UI only offers the values valid for the row's
`recordType` (§2). Full set:

```
new · triaged · approved · rejected · in-progress · answered ·
resolved · fulfilled · known-error · investigating · planned ·
backed-out · done · closed
```

Validity matrix (✅ = selectable for that type):

| status | incident | request | query | problem | change |
|---|:--:|:--:|:--:|:--:|:--:|
| new | ✅ | ✅ | ✅ | | |
| triaged | ✅ | ✅ | | | |
| approved | | ✅ | | | |
| rejected | | ✅ | | | |
| in-progress | ✅ | ✅ | | | ✅ |
| answered | | | ✅ | | |
| investigating | | | | ✅ | |
| known-error | | | | ✅ | |
| resolved | ✅ | | | ✅ | |
| fulfilled | | ✅ | | | |
| planned | | | | | ✅ |
| done | | | | | ✅ |
| backed-out | | | | | ✅ |
| closed | ✅ | ✅ | ✅ | ✅ | |

Back-compat: legacy `open`/`in-progress`/`done`/`wont-fix` remain accepted on
write and render as `new`/`in-progress`/`resolved`/`closed` respectively.

---

## 5. Enum reference

| Enum | Values |
|---|---|
| `recordType` | `incident` `request` `query` `problem` `change` `null` |
| `sourceType` / `type` | `bug` `content` `request` `general` |
| `impact` | `high` `medium` `low` |
| `urgency` | `high` `medium` `low` |
| `priority` | `P1` `P2` `P3` `P4` |
| `status` | see §4 |

---

## 6. Problems — `problems/{PRB-000n}`

Problems aggregate incidents, so they get their own collection and a **global**
sequence (`PRB-0001`, not per-app — a problem can span apps). Its own
`counters/PRB` document, mirroring the ticket counter mechanism.

| Field | Type | Notes |
|---|---|---|
| `ref` | string | `PRB-0001` (global) |
| `title` | string | short problem statement |
| `description` | string | root-cause analysis / narrative |
| `status` | string | `open`/`investigating`/`known-error`/`resolved`/`closed` |
| `priority` | string | highest priority among linked incidents |
| `affectedApps` | array<string> | distinct `appId`s of linked incidents |
| `incidentRefs` | array<string> | tickets attached via their `problemRef` |
| `workaround` | string | if `known-error` |
| `createdAt` / `resolvedAt` | timestamp | |

---

## 7. UI preferences (persisted admin config)

The admin console's configurable columns, bulk-select defaults, view mode and
saved views (see [`admin-console-spec.md`](admin-console-spec.md)) are **user
preferences**, not ticket data. Storage, in order of cost:

1. **Phase 1 — `localStorage`** (per browser). Zero backend. Key
   `benjuicey-admin-prefs`:
   ```jsonc
   {
     "columns": [ { "key": "ref", "visible": true, "width": 110 }, ... ],
     "density": "compact" | "comfortable",
     "view": "table" | "cards",
     "defaultStatus": "open",
     "savedViews": [ { "name": "P1 open incidents", "filters": {...}, "sort": {...}, "columns": [...] } ]
   }
   ```
2. **Phase 2 — server-side** (optional, if you use more than one device):
   `admins/{id}/prefs` in Firestore, read/written via new admin endpoints. Only
   worth it once multi-device drift is annoying.

Keeping prefs out of the ticket documents is deliberate — ticket data stays pure
and analysable; UI state is disposable and browser-local first.

---

## 8. Indexes & queries

Common admin queries and the Firestore composite indexes they need:

| Query | Fields |
|---|---|
| Open tickets, newest first (default view) | `status` + `createdAt desc` |
| Untriaged queue | `recordType` (null) + `createdAt` |
| A queue by type & priority | `recordType` + `priority` |
| Overdue | `slaDueAt asc` (filter `< now` client-side) |
| One app's tickets | `appId` + `status` |

Today the Worker pulls the last 200 by `timestamp desc` and filters client-side —
fine at current volume. Add these indexes only when server-side filtering /
pagination is introduced (`admin-console-spec.md` "pagination").

---

## 9. Migration / rollout

- **No forced migration.** New fields are optional with defaults; the Worker starts
  stamping `sourceType`/`recordType:null`/`status:"new"` on new submits, and
  triage backfills the rest per-ticket.
- **Lazy backfill:** the first time a ticket is triaged, copy `type→sourceType`,
  `timestamp→createdAt`, and set `recordType`.
- **Widen `updateSubmission`** (`worker/src/firestore.ts`) to accept the new fields
  — today it only allows `status` + `notes`.
- Order tracks the phases in `itsm-spec.md` §10 / `backlog.md` Epic 6.
