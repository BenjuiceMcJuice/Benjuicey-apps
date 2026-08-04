// ─── Work notes — the dated journal on a ticket ──────────────────────
// Imported by BOTH the Worker (`worker/src/*`) and the admin dashboard
// (`app/admin/page.tsx`), like `lib/status.ts`. Keep it dependency-free and
// DOM-free: the Worker typechecks it with `lib: ES2022` only.
//
// A ticket's `notes` field was one string that each save overwrote — the
// second update wiped the first, so there was no record of what happened
// when. `workNotes` replaces it with an append-only list: every update is
// its own entry, stamped with the time it was added, and nothing already
// written is ever edited or removed. That's the ITSM "work notes" journal —
// the running story of a ticket, as opposed to the closure note, which is
// the single line explaining how it ended.
//
// The `notes` field is left in place (see LEGACY) so no existing text is
// lost; the console shows it read-only above the journal.

export interface WorkNote {
  /**
   * ISO timestamp, stamped by the Worker when the note is appended — server
   * time, never the browser's, so entries stay ordered across devices.
   */
  at: string
  text: string
}

/**
 * Longest single update we store. A work note is a paragraph about what you
 * did or found, not an essay: the cap keeps one runaway paste from eating
 * into Firestore's 1 MB per-document limit, which the whole journal shares.
 */
export const WORK_NOTE_MAX = 2000

/** Trims an incoming note and caps it; blank (or non-string) means "no note". */
export function normaliseWorkNoteText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, WORK_NOTE_MAX)
}

export function isWorkNote(value: unknown): value is WorkNote {
  if (typeof value !== 'object' || value === null) return false
  const n = value as Record<string, unknown>
  return typeof n.at === 'string' && typeof n.text === 'string'
}

/**
 * Reads whatever is stored in `workNotes` into a clean list. Anything that
 * isn't a well-formed entry is dropped rather than rendered — tickets
 * written before the journal existed have no field at all, which reads as
 * an empty list.
 */
export function normaliseWorkNotes(value: unknown): WorkNote[] {
  if (!Array.isArray(value)) return []
  return value.filter(isWorkNote).map(n => ({ at: n.at, text: n.text }))
}

/**
 * Newest first — the order you read a ticket in, since the last thing that
 * happened is the thing you need. Entries are *stored* in the order they
 * were appended; this only affects display. Unparseable timestamps sort to
 * the bottom instead of scrambling the list.
 */
export function sortWorkNotesNewestFirst(notes: WorkNote[]): WorkNote[] {
  const at = (n: WorkNote) => {
    const t = new Date(n.at).getTime()
    return Number.isFinite(t) ? t : -Infinity
  }
  return [...notes].sort((a, b) => at(b) - at(a))
}

/** Date and time of an entry, e.g. `04/08/2026, 14:32`. */
export function formatWorkNoteAt(at: string): string {
  const d = new Date(at)
  if (!Number.isFinite(d.getTime())) return at
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
