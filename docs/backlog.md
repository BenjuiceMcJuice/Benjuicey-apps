# Backlog — Benjuicey Apps Platform

## Vision

Turn this portfolio site into a centralised platform: public-facing app directory on the front, shared feedback infrastructure on the back, and a private admin dashboard to manage it all. Every app Benjuicey builds feeds into one place.

---

## Epics

### 1. Centralised Feedback API

**Goal:** One Cloudflare Worker endpoint that every app can POST feedback to. Replaces Formspree.

**Tasks:**
- [ ] Set up Firestore project and collection schema (see below)
- [ ] Build Cloudflare Worker to handle form submissions
  - Generate sequential ref IDs (`BEJ-0001`, `BEJ-0002`, etc.)
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
  - Filter by app, type, status
  - Sort by date, app, type
  - Search by keyword
- [ ] Single submission view — update status, add internal notes, change type/tag
- [ ] Stats panel — open count by app, fault vs request split, submissions over time
- [ ] Move hosting from GitHub Pages to Cloudflare Pages (required for server-side admin routes)

---

### 3. Embeddable Feedback Widget

**Goal:** A reusable component any app can drop in to collect feedback without building its own form.

**Tasks:**
- [ ] Build a small JS widget (modal with form — name, email, type, message)
- [ ] Widget accepts an `appId` param to tag submissions correctly
- [ ] Host widget script so other apps can load it via a `<script>` tag
- [ ] Test embed in at least one other app
- [ ] Optional: floating feedback button style (sits in corner of host app)

---

### 4. AI Analysis (Claude integration)

**Goal:** On demand, analyse the submissions database to surface useful insights.

**Tasks:**
- [ ] Connect Firestore read access to Claude sessions
- [ ] Queries to support:
  - Most common requests across all apps
  - Duplicate / similar ideas (deduplicate)
  - Fault frequency per app
  - "What should I build next?" priority suggestions based on volume + recency
  - Summary report per app

---

### 5. Portfolio Content

**Goal:** Replace all placeholder content with real apps and links.

**Tasks:**
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

---

## Notes

- Every app should pass its own `appId` when calling the Worker so submissions are correctly attributed
- The ref ID sequence should be global across all apps (not per-app) so `BEJ-0042` is unique regardless of which app it came from
- Admin dashboard must be server-side rendered (not static) — this is the main reason to migrate off GitHub Pages to Cloudflare Pages
- Formspree can be removed once the Worker is live and tested
