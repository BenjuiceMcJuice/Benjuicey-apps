# Backlog — Benjuicey Apps Platform

## Vision

Turn this portfolio site into a centralised platform: public-facing app directory on the front, shared feedback infrastructure on the back, and a private admin dashboard to manage it all. Every app Benjuicey builds feeds into one place.

---

## Epics

### 1. Centralised Feedback API

**Goal:** One Cloudflare Worker endpoint that every app can POST feedback to. Replaces Formspree.

**Tasks:**
- [ ] Set up Firestore project and collection schema (see below)
- [ ] Assign a trigram to each app (e.g. `BEJ` = portfolio, `GAM` = game, `TOL` = tool)
- [ ] Build Cloudflare Worker to handle form submissions
  - Accept `appId` and map it to the app's trigram
  - Generate sequential per-app ref IDs (`BEJ-0001`, `GAM-0001`, etc.)
  - Write submission to Firestore
  - Send confirmation email to user (ref in subject line e.g. `[BEJ-0042] Request received`)
  - Return success/error response
- [ ] Add CORS headers so any app can call the Worker
- [ ] Add basic rate limiting to prevent spam
- [ ] Update portfolio contact form to POST to Worker instead of Formspree
- [ ] Test end-to-end: submit → Firestore → confirmation email

**Firestore schema:**
```
submissions/{ref}
  ref:        string   // "BEJ-0001"
  appId:      string   // "portfolio" | "game-x" | "tool-y"
  trigram:    string   // "BEJ" | "GAM" | "TOL"
  type:       string   // "fault" | "request" | "idea" | "general"
  status:     string   // "open" | "in-progress" | "done" | "wont-fix"
  name:       string
  email:      string
  message:    string
  timestamp:  datetime
  notes:      string   // internal notes, not visible to submitter
```

---

### 2. Admin Dashboard

**Goal:** Private page on this site to view and manage all submissions across every app.

**Tasks:**
- [ ] Create `/admin` route (protected — password or magic link auth)
- [ ] Submissions table view
  - Filter by app/trigram, type, status
  - Sort by date, app, type
  - Search by keyword
- [ ] Single submission view — update status, add internal notes, change type/tag
- [ ] Stats panel — open count by app, fault vs request split, submissions over time
- [ ] AI Analysis button (see Epic 4)
- [ ] Move hosting from GitHub Pages to Cloudflare Pages (required for server-side admin routes)

---

### 3. Embeddable Feedback Widget

**Goal:** A reusable component any app can drop in to collect feedback without building its own form.

**Tasks:**
- [ ] Build a small JS widget (modal with form — name, email, type, message)
- [ ] Widget accepts an `appId` param to tag submissions with the correct trigram
- [ ] Standardised form fields across all apps so data is consistent
- [ ] Host widget script so other apps can load it via a `<script>` tag
- [ ] Test embed in at least one other app
- [ ] Optional: floating feedback button style (sits in corner of host app)

---

### 4. AI Analysis (Claude integration)

**Goal:** On-demand analysis triggered from the admin dashboard — a single button that queries Firestore, calls the Claude API, and renders insights inline. No scheduled jobs, no email digests — runs when you want it.

**Tasks:**
- [ ] Add "Analyse" button to admin dashboard
- [ ] On click: read submissions from Firestore, send to Claude API, render results on page
- [ ] Analysis to cover:
  - Most common requests across all apps
  - Duplicate / similar ideas flagged and grouped
  - Fault frequency per app
  - Cross-app patterns (e.g. "dark mode requested in 3 apps")
  - Priority suggestions — what to build next based on volume + recency
  - Per-app summary
- [ ] Option to scope analysis — all apps, or single app

---

### 5. Portfolio Content

**Goal:** Replace all placeholder content with real apps and links.

**Tasks:**
- [x] Finalise trigram list for all existing apps — see `docs/trigrams.md`
- [ ] Fill in `data/categories.ts` with real apps, descriptions, URLs
- [ ] Decide on final categories
- [ ] Add real Buy Me a Coffee link in `components/Nav.tsx`
- [ ] Review copy on home and contact pages

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | Next.js (this repo) |
| Hosting | Cloudflare Pages (migration from GitHub Pages) |
| Feedback API | Cloudflare Worker |
| Database | Firestore |
| Email | Resend (or Cloudflare Email Workers) |
| Auth (admin) | TBD — magic link or simple password |
| AI Analysis | Claude API (called from admin dashboard on demand) |

---

## Notes

- Every app gets a 3-letter trigram — decide these before building the Worker so ref IDs are consistent from day one
- Ref numbering is per-app (not global) so each app has its own clean sequence starting at 0001
- The embeddable widget should be identical across all apps — same fields, same design — so the Firestore data is uniform and analysable
- Admin dashboard must be server-side rendered (not static) — this is the main reason to migrate off GitHub Pages to Cloudflare Pages
- Formspree can be removed once the Worker is live and tested
