# Admin Console — UX Enhancements (Spec / Design)

**Status: proposed design, not built yet.** Where the `/admin` fault console
(`app/admin/page.tsx`) goes next, on top of the technical table already shipped
(columns, wildcard filters, default = open, click-to-sort). Covers the requested
features — **movable / editable columns**, **multi-select bulk updates**, an
**iOS-friendly view** — plus a prioritised list of further ideas.

> Data side: [`ticket-data-model.md`](ticket-data-model.md). Process side:
> [`itsm-spec.md`](itsm-spec.md). This doc is the **UI/UX** layer over both.

---

## 1. Configurable columns (movable / editable)

Make the column set user-controlled, persisted per browser
(`benjuicey-admin-prefs`, see data-model §7).

**Reorder (movable)**
- Drag-and-drop column headers to reorder. First pass can be simpler: ◄ ► nudge
  buttons in a small "columns" menu, since drag-and-drop in a CSS-grid table is
  fiddly and the nudge version ships in a day.
- The shared `GRID_TEMPLATE` becomes derived from the ordered, visible column list
  instead of the current hard-coded constant.

**Show / hide (editable set)**
- A "⚙ columns" popover lists every available column with a checkbox. Hiding a
  column drops its track from the grid template. Always keep ≥1 column + the
  expand chevron.
- Available columns grow with the data model: REF, STATUS, TYPE (source), **RECORD
  TYPE**, **PRIORITY**, **APP**, FROM, SUBJECT, **ASSIGNEE**, **SLA DUE**, LOGGED,
  **TAGS**.

**Resize**
- Drag column edges to set widths; persisted as pixel widths. Optional in phase 1
  (fixed tracks are fine to start).

**"Editable" — two readings, both covered**
- *Configurable columns* (above) — which columns, in what order/width.
- *Inline cell editing* — change `status` / `priority` / `assignee` straight from
  the row via a dropdown, no expand needed. See "Further ideas → inline quick-edit".

**Persistence:** column order, visibility and widths live in `localStorage` first
(data-model §7), server-side later if multi-device drift bites.

---

## 2. Multi-select & bulk actions

Turn the console into a real triage tool: select many, act once.

**Selection**
- A leading checkbox column. Header checkbox = select-all **within the current
  filtered set** (never the hidden rows — that's the footgun).
- **Shift-click** for range select; **Cmd/Ctrl-click** to add/remove.
- A persistent "**N selected**" pill; selection clears when filters change (with a
  brief "selection cleared" toast so it isn't silent).

**Bulk action bar** (appears when ≥1 selected, docked top or bottom):
- Set **status** (only values valid for the selected rows' record types)
- Set **record type** (i.e. bulk-triage)
- Set **priority** / **impact** / **urgency**
- Set **assignee**
- Add a **note** / **tag** to all
- **Close with reason** (resolved / duplicate / won't-do)
- **Export selected** (CSV / JSON — see further ideas)
- Destructive/large ops (>N rows, or close/delete) show a confirm dialog with the
  count.

**Backend (Worker change required):** today `PATCH /admin/submissions/:ref` is
one-at-a-time. Add **`POST /admin/bulk`** taking `{ refs: [...], updates: {...} }`
and applying them in a batched Firestore commit (reuse the transaction pattern in
`firestore.ts`). UI updates optimistically, reconciles on response, and shows a
per-row failure list if any writes fail.

---

## 3. iOS-friendly view

The current table scrolls horizontally — acceptable on desktop, poor on a phone.
Add a responsive **card view** and a manual toggle.

**Responsive card/stack layout**
- Below ~700px (and as a forced option), render each ticket as a **stacked card**
  instead of a grid row: REF + STATUS badge on top, SUBJECT prominent, then
  TYPE/APP/PRIORITY/LOGGED as small labelled chips. Tap to expand the same detail
  panel. Keeps the pixel-box aesthetic (border + hard shadow per card).
- **View toggle** in the toolbar: `▤ table / ▦ cards`, persisted (`view` pref).
  Auto-selects cards on narrow screens but the user can override.

**Touch / iOS specifics**
- Tap targets ≥44×44px; bigger checkboxes and status chips on touch.
- Inputs at `font-size: 16px+` to stop iOS Safari's auto-zoom on focus.
- Respect the notch: `env(safe-area-inset-*)` padding on the sticky toolbar and the
  bulk action bar; `-webkit-overflow-scrolling: touch` for momentum.
- Sticky **search + status presets** at the top; bulk action bar docks above the
  home-indicator, not under it.
- Filtering on mobile: collapse the per-column filter row into a single **global
  search** box (still `*`-wildcard aware) plus a "filters" sheet, since a 7-input
  row doesn't fit a phone.

**Home-screen / PWA polish (cheap wins)**
- `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, a
  `theme-color` matching `--color-dark`, and an app icon so "Add to Home Screen"
  gives a clean standalone console. Optional but nice for a phone-first triage.

---

## 4. Further ideas (prioritised)

**High value, low cost**
1. **Saved views.** Name a combo of filters + sort + columns ("P1 open incidents",
   "untriaged this week") and one-tap recall it. Pure client state
   (data-model §7 `savedViews`).
2. **URL-encoded state.** Reflect filters/sort/view/selection in the query string
   so a view is bookmarkable and shareable (and survives refresh). No backend.
3. **Global search box.** One field that matches across all columns (wildcard
   aware), alongside the per-column filters — faster for "just find X".
4. **Inline quick-edit.** Change status/priority/assignee from the row via a
   dropdown without expanding — huge for triage throughput.
5. **CSV / JSON export** of the current filtered (or selected) set — for offline
   review, backups, or feeding a Claude triage run.

**Medium value**
6. **SLA / age indicators.** Show ticket age and an overdue flag (red when
   `slaBreached`); an *Overdue* queue preset. Depends on the priority/SLA fields.
7. **Density toggle.** Compact vs comfortable row height (`density` pref) — compact
   fits far more on screen for scanning.
8. **"N new since you loaded" banner.** On refresh/poll, surface how many arrived
   rather than silently changing the list. Optional light auto-poll (e.g. 60s).
9. **Per-queue badge counts.** Numbers on the status/record-type presets
   (open 12 · untriaged 4 · overdue 2) so the shape of the backlog is visible at a
   glance.
10. **Keyboard shortcuts.** `j/k` move, `x` select, `e` expand, `s` cycle status,
    `/` focus search — makes bulk triage keyboard-only.

**Nice to have / later**
11. **Audit trail per ticket.** A small event log (who changed what, when) —
    `tickets/{ref}/events` subcollection. Valuable once AI triage writes back, so
    it's clear what was AI vs human.
12. **Duplicate detection + merge UI.** Surface likely dupes (same app + similar
    text) and merge into one, setting `duplicateOf`.
13. **Pagination / virtualisation.** The Worker caps at 200; add cursor pagination
    and row virtualisation when volume outgrows a single fetch.
14. **Light/dark toggle.** The palette is already dark-leaning; a proper toggle
    (respecting `prefers-color-scheme`) for daytime use.
15. **Charts.** A tiny inbound-volume sparkline / per-app bar so trends are visible
    — pairs with the planned AI analysis (backlog Epic 4).

---

## 5. Persistence summary

| What | Where | When |
|---|---|---|
| Column order / visibility / width | `localStorage` → server later | phase 1 |
| Density, view (table/cards), default status | `localStorage` | phase 1 |
| Saved views | `localStorage` → server later | phase 2 |
| Selection | in-memory only (ephemeral) | — |
| URL-encoded filters/sort | the URL | phase 1 |

(Server-side prefs use `admins/{id}/prefs`, data-model §7 — only if multi-device.)

---

## 6. Rollout

| Phase | Deliverable |
|---|---|
| **A** | Configurable columns (reorder via nudge + show/hide) · view toggle + card/iOS layout · URL-encoded state · saved views |
| **B** | Multi-select + bulk action bar · `POST /admin/bulk` Worker endpoint · inline quick-edit |
| **C** | SLA/age + overdue queue · badge counts · density · "N new" banner · CSV/JSON export |
| **D** | Audit trail · duplicate merge · pagination/virtualisation · keyboard shortcuts · charts |

Each phase is independently shippable and none blocks the existing console.

---

## 7. Out of scope

Full drag-resize theming engine, per-user accounts/roles (it's a single-admin
password gate), real-time websockets (light polling is enough), and offline sync.
Keep it a fast, single-operator triage surface — not a multi-tenant help-desk SaaS.
