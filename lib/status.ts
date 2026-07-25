// ─── Ticket status model — the single source of truth ────────────────
// Imported by BOTH the Worker (`worker/src/*`) and the admin dashboard
// (`app/admin/page.tsx`), so the backend and the UI can never drift.
// Keep this file dependency-free and DOM-free: the Worker typechecks it
// with `lib: ES2022` only.

/**
 * The canonical lifecycle, in workflow order:
 *
 *   new → in-progress → resolved → closed
 *          ↕
 *        pending          (waiting on someone/something else)
 *
 * `closed` is terminal and is NEVER set by hand — a `resolved` ticket
 * auto-closes AUTO_CLOSE_DAYS days later, which leaves a window to test
 * the fix and reopen if it didn't hold.
 */
export const STATUSES = ['new', 'in-progress', 'pending', 'resolved', 'closed'] as const

export type Status = (typeof STATUSES)[number]

/** Human labels — the UI shows these, the data stores the enum values. */
export const STATUS_LABELS: Record<Status, string> = {
  new: 'new',
  'in-progress': 'work in progress',
  pending: 'pending',
  resolved: 'resolved',
  closed: 'closed',
}

/**
 * Statuses a human may set directly. `closed` is deliberately absent:
 * you resolve a ticket and the 7-day timer closes it.
 */
export const SETTABLE_STATUSES: Status[] = ['new', 'in-progress', 'pending', 'resolved']

/**
 * The "open" view = everything still on someone's plate, i.e. anything
 * that isn't resolved or closed.
 */
export const OPEN_STATUSES: Status[] = ['new', 'in-progress', 'pending']

/** Terminal-ish states that drop out of the open queue. */
export const CLOSED_STATUSES: Status[] = ['resolved', 'closed']

/** Colours shared by the stat tiles, status cells and status buttons. */
export const STATUS_COLORS: Record<Status, string> = {
  new: '#e74c3c',
  'in-progress': '#f39c12',
  pending: '#2980b9',
  resolved: '#27ae60',
  closed: '#95a5a6',
}

/** Sort order for the STATUS column — workflow order, not alphabetical. */
export const STATUS_ORDER: Record<string, number> = STATUSES.reduce<Record<string, number>>(
  (acc, s, i) => ({ ...acc, [s]: i }),
  {},
)

/**
 * Statuses written by the pre-redesign system, mapped onto the new model.
 * Old records are rewritten in place by the status sweep (see
 * `worker/src/sweep.ts`); this map also normalises on read so nothing ever
 * renders a status the UI doesn't know about.
 */
export const LEGACY_STATUS_MAP: Record<string, Status> = {
  open: 'new',
  done: 'resolved',
  'wont-fix': 'closed',
}

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

/** Maps any stored value (legacy, unknown, empty) to a canonical status. */
export function normaliseStatus(value: unknown): Status {
  if (isStatus(value)) return value
  if (typeof value === 'string' && LEGACY_STATUS_MAP[value]) return LEGACY_STATUS_MAP[value]
  return 'new'
}

export function isOpenStatus(value: unknown): boolean {
  return OPEN_STATUSES.includes(normaliseStatus(value))
}

export function statusLabel(value: unknown): string {
  return STATUS_LABELS[normaliseStatus(value)]
}

export function statusColor(value: unknown): string {
  return STATUS_COLORS[normaliseStatus(value)]
}

// ─── closure codes & notes ───────────────────────────────────────────
// *Why* a ticket ended: a required code (`closureCode`) plus an optional
// free-text line (`closureNote`). Both are set when a ticket is resolved —
// the Worker requires the code in the same request, so "resolved" is never a
// dead end with no explanation — and carry through to `closed`.
//
// The code is deliberately one of a handful: enough to answer "what actually
// happens to feedback?" by sorting a column, without turning triage into
// form-filling. The note is where the specifics go ("was a stale
// localStorage key", "already covered by WDA-0007").

export const CLOSURE_CODES = [
  'fixed',
  'implemented',
  'answered',
  'wont-fix',
  'duplicate',
  'cannot-reproduce',
  'spam',
  'unspecified',
] as const

export type ClosureCode = (typeof CLOSURE_CODES)[number]

export const CLOSURE_CODE_LABELS: Record<ClosureCode, string> = {
  fixed: 'fixed',
  implemented: 'implemented',
  answered: 'answered',
  'wont-fix': "won't fix",
  duplicate: 'duplicate',
  'cannot-reproduce': "can't reproduce",
  spam: 'spam / invalid',
  unspecified: 'unspecified',
}

/** What each code means — shown as tooltips on the picker. */
export const CLOSURE_CODE_HINTS: Record<ClosureCode, string> = {
  fixed: 'it was broken, now it works',
  implemented: 'the requested thing was built or added',
  answered: 'a question or comment answered — nothing to change',
  'wont-fix': 'real, understood, deliberately not doing it',
  duplicate: 'already covered by another ticket',
  'cannot-reproduce': "couldn't make it happen; nothing to fix",
  spam: 'not a genuine submission',
  unspecified: 'closed before closure codes existed',
}

/**
 * Codes a human may choose. `unspecified` is absent: it exists only to
 * backfill tickets resolved before this field did.
 */
export const SELECTABLE_CLOSURE_CODES: ClosureCode[] =
  CLOSURE_CODES.filter(c => c !== 'unspecified')

export function isClosureCode(value: unknown): value is ClosureCode {
  return typeof value === 'string' && (CLOSURE_CODES as readonly string[]).includes(value)
}

/** Label for display; empty string when a ticket has no code (i.e. isn't done). */
export function closureCodeLabel(value: unknown): string {
  return isClosureCode(value) ? CLOSURE_CODE_LABELS[value] : ''
}

/** Statuses that carry a closure code (and note). */
export function takesClosureCode(status: unknown): boolean {
  const s = normaliseStatus(status)
  return s === 'resolved' || s === 'closed'
}

/**
 * Longest closure note we store. It's a "what actually happened" line to jog
 * your memory in six months — not a changelog entry — so it's capped rather
 * than unbounded. The Worker truncates to this; the UI's input matches it.
 */
export const CLOSURE_NOTE_MAX = 500

/** Trims a closure note, treating blank as "no note". */
export function normaliseClosureNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, CLOSURE_NOTE_MAX)
  return trimmed === '' ? null : trimmed
}

// ─── auto-close policy ───────────────────────────────────────────────
// A resolved ticket stays resolved for a week so a fix can be tested (and
// the submitter can come back) before the ticket closes for good.

export const AUTO_CLOSE_DAYS = 7
export const AUTO_CLOSE_MS = AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000

/** When a ticket resolved at `resolvedAt` is due to auto-close. */
export function autoCloseDueAt(resolvedAt: string | number | Date | null | undefined): number | null {
  if (!resolvedAt) return null
  const at = new Date(resolvedAt).getTime()
  return Number.isFinite(at) ? at + AUTO_CLOSE_MS : null
}

/** True once the auto-close window has elapsed. */
export function isAutoCloseDue(
  resolvedAt: string | number | Date | null | undefined,
  now: number,
): boolean {
  const due = autoCloseDueAt(resolvedAt)
  return due !== null && due <= now
}

/**
 * Whole days left before auto-close, rounded up (so "1 day" means today or
 * tomorrow, never "0 days" while the ticket is still open). `null` when
 * there's no usable `resolvedAt`, `0` once it's due.
 */
export function daysUntilAutoClose(
  resolvedAt: string | number | Date | null | undefined,
  now: number,
): number | null {
  const due = autoCloseDueAt(resolvedAt)
  if (due === null) return null
  return Math.max(0, Math.ceil((due - now) / (24 * 60 * 60 * 1000)))
}
