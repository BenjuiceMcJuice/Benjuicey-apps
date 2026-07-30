'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  AUTO_CLOSE_DAYS,
  CLOSURE_CODE_HINTS,
  CLOSURE_CODE_LABELS,
  CLOSURE_NOTE_MAX,
  ClosureCode,
  SELECTABLE_CLOSURE_CODES,
  SETTABLE_STATUSES,
  STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  Status,
  autoCloseDueAt,
  closureCodeLabel,
  daysUntilAutoClose,
  isClosureCode,
  isOpenStatus,
  normaliseStatus,
  statusColor,
  statusLabel,
  takesClosureCode,
} from '@/lib/status'

const API = process.env.NEXT_PUBLIC_FEEDBACK_API_URL!

interface Submission {
  ref: string
  appId: string
  trigram: string
  type: string
  status: Status
  name: string
  email: string
  message: string
  timestamp: string
  notes: string
  /** Why the ticket ended — required to resolve, carried through to closed. */
  closureCode: ClosureCode | null
  /** The specifics behind the code — optional free text. */
  closureNote: string | null
  /** Set when status → `resolved`; the auto-close clock counts from here. */
  resolvedAt: string | null
  closedAt: string | null
  autoClosed: boolean | null
}

// ─── views ───────────────────────────────────────────────────────────
// A view is a status *bucket*, not a plain status match: `open` means
// "still on the pile" — anything that isn't resolved or closed. It's the
// default landing view. The per-column STATUS filter is separate and still
// free-text/wildcard, so both can be used together.
type View = 'all' | 'open' | Status

const VIEWS: { v: View; label: string }[] = [
  { v: 'all', label: 'all' },
  { v: 'open', label: 'open' },
  ...STATUSES.map(s => ({ v: s as View, label: STATUS_LABELS[s] })),
]

function inView(view: View, status: string): boolean {
  if (view === 'all') return true
  if (view === 'open') return isOpenStatus(status)
  return normaliseStatus(status) === view
}

// ─── column definitions for the fault table ──────────────────────────
// key = field on Submission, label = header, flex = grid track sizing.
type ColKey =
  'ref' | 'status' | 'type' | 'appId' | 'name' | 'message' | 'timestamp' | 'closureCode'

interface Column {
  key: ColKey
  label: string
  track: string
}

const COLUMNS: Column[] = [
  { key: 'ref', label: 'REF', track: 'minmax(96px, 0.9fr)' },
  // Wide enough for "work in progress" plus a resolved row's ·Nd countdown.
  { key: 'status', label: 'STATUS', track: '140px' },
  { key: 'type', label: 'TYPE', track: '92px' },
  { key: 'appId', label: 'APP', track: 'minmax(110px, 1fr)' },
  { key: 'name', label: 'FROM', track: 'minmax(110px, 1fr)' },
  { key: 'message', label: 'SUBJECT', track: 'minmax(180px, 2.4fr)' },
  { key: 'timestamp', label: 'LOGGED', track: '104px' },
  // Blank until a ticket is resolved — which is itself information, and makes
  // "why did things close?" a one-click sort.
  { key: 'closureCode', label: 'CLOSURE', track: '138px' },
]

// Leading 36px track = row-selection checkbox; trailing 34px = expand chevron.
const GRID_TEMPLATE = '36px ' + COLUMNS.map(c => c.track).join(' ') + ' 34px'
// The sum of every track's minimum — i.e. the narrowest the grid can be
// without squashing. Keeping it exact means the whole table (CLOSURE column
// included) fits a laptop window, and SUBJECT absorbs any slack above it.
const GRID_MIN_WIDTH = 1040

// ─── wildcard filtering ──────────────────────────────────────────────
// Empty filter matches everything. A filter containing `*` is treated as a
// glob anchored to the whole cell value (`WDA-*`, `*dark mode*`). A filter
// with no `*` is a plain case-insensitive substring match.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesFilter(value: string, filter: string): boolean {
  const q = filter.trim().toLowerCase()
  if (!q) return true
  const v = (value ?? '').toLowerCase()
  if (q.includes('*')) {
    const pattern = '^' + q.split('*').map(escapeRegex).join('.*') + '$'
    try {
      return new RegExp(pattern).test(v)
    } catch {
      return v.includes(q.replace(/\*/g, ''))
    }
  }
  return v.includes(q)
}

/**
 * One-line explanation of where a ticket sits in the auto-close window —
 * used as the STATUS cell's tooltip and spelled out in the detail panel.
 */
function autoCloseNote(
  sub: {
    status: Status; closureCode: ClosureCode | null
    resolvedAt: string | null; closedAt: string | null; autoClosed: boolean | null
  },
  now: number,
): string {
  if (sub.status === 'resolved') {
    const days = daysUntilAutoClose(sub.resolvedAt, now)
    const due = autoCloseDueAt(sub.resolvedAt)
    if (days === null || due === null) return `auto-closes ${AUTO_CLOSE_DAYS} days after being resolved`
    if (days === 0) return 'auto-closes on the next sweep'
    return `auto-closes in ${days} day${days === 1 ? '' : 's'} (${new Date(due).toLocaleDateString('en-GB')})`
      + ' — reopen before then if the fix didn\'t hold'
  }
  if (sub.status === 'closed') {
    const how = sub.autoClosed ? 'auto-closed' : 'closed'
    const when = sub.closedAt ? ` on ${new Date(sub.closedAt).toLocaleDateString('en-GB')}` : ''
    const why = sub.closureCode ? ` as ${closureCodeLabel(sub.closureCode)}` : ''
    return `${how}${when}${why}`
  }
  return ''
}

type Filters = Record<ColKey, string>
const EMPTY_FILTERS: Filters = {
  ref: '', status: '', type: '', appId: '', name: '', message: '', timestamp: '',
  closureCode: '',
}

// ─── ticket sheet ────────────────────────────────────────────────────
// The per-ticket form. It deliberately lives *outside* the table's
// horizontally-scrolling container: as an inline expanded row it inherited
// the grid's 1040px min-width, so on a phone every field past ~390px was
// simply off-screen. As an overlay it's sized by the viewport instead.
//
// The fields run in the order you actually read a ticket: what came in
// (immutable), then what you're doing about it, then your own notes.

interface TicketSheetProps {
  sub: Submission
  now: number
  saving: boolean
  /** `undefined` = not mid-resolve; `code: ''` = armed, none picked yet. */
  pending: { code: ClosureCode | ''; note: string } | undefined
  notes: string
  closureNote: string
  onClose: () => void
  onStatusChange: (status: Status) => void
  onArmResolve: () => void
  onPendingChange: (pending: { code: ClosureCode | ''; note: string }) => void
  onConfirmResolve: () => void
  onCancelResolve: () => void
  onClosureCodeChange: (code: ClosureCode) => void
  onClosureNoteChange: (note: string) => void
  onSaveClosureNote: () => void
  onNotesChange: (notes: string) => void
  onSaveNotes: () => void
}

function TicketSheet({
  sub, now, saving, pending, notes, closureNote,
  onClose, onStatusChange, onArmResolve, onPendingChange, onConfirmResolve,
  onCancelResolve, onClosureCodeChange, onClosureNoteChange, onSaveClosureNote,
  onNotesChange, onSaveNotes,
}: TicketSheetProps) {
  const resolving = pending !== undefined
  const carriesClosure = takesClosureCode(sub.status)
  const daysLeft = sub.status === 'resolved' ? daysUntilAutoClose(sub.resolvedAt, now) : null

  // Choosing "resolved" reveals the closure controls further down the sheet;
  // on a phone they land below the fold, so bring them to you.
  const resolveBlock = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (resolving) resolveBlock.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [resolving])

  return (
    // Clicking the backdrop closes; clicks inside the sheet are stopped below.
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`ticket ${sub.ref}`}
      onClick={onClose}
    >
      <div className="ticket-sheet" onClick={e => e.stopPropagation()}>
        {/* Head: identity + where it sits, pinned while the body scrolls. */}
        <div className="ticket-sheet-head">
          <span className="pixel-font ticket-sheet-ref">{sub.ref}</span>
          <span
            className="retro-font ticket-sheet-status"
            style={{ color: statusColor(sub.status) }}
          >
            {statusLabel(sub.status)}
            {daysLeft !== null && (
              <span style={{ opacity: 0.7 }}> ·{daysLeft}d</span>
            )}
          </span>
          <button
            className="retro-font ticket-sheet-close"
            onClick={onClose}
            title="close (esc)"
            aria-label="close"
          >
            ✕
          </button>
        </div>

        <div className="ticket-sheet-body">
          {/* 1 — what came in. Nothing here is editable. */}
          <div className="ticket-section">
            <div className="pixel-font ticket-section-title">THE REPORT</div>
            <div className="ticket-grid">
              <div className="ticket-field">
                <span className="retro-font ticket-label">APP</span>
                <span className="retro-font ticket-value">{sub.appId} ({sub.trigram})</span>
              </div>
              <div className="ticket-field">
                <span className="retro-font ticket-label">TYPE</span>
                <span className="retro-font ticket-value">{sub.type}</span>
              </div>
              <div className="ticket-field">
                <span className="retro-font ticket-label">FROM</span>
                <span className="retro-font ticket-value">{sub.name || '—'}</span>
              </div>
              <div className="ticket-field">
                <span className="retro-font ticket-label">EMAIL</span>
                <span className="retro-font ticket-value">
                  {sub.email
                    ? (
                      // One tap to reply on a phone, with the ref pre-filled.
                      <a
                        href={`mailto:${sub.email}?subject=${encodeURIComponent(`Re: ${sub.ref}`)}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        {sub.email}
                      </a>
                    )
                    : 'not given'}
                </span>
              </div>
              <div className="ticket-field">
                <span className="retro-font ticket-label">LOGGED</span>
                <span className="retro-font ticket-value">
                  {new Date(sub.timestamp).toLocaleString('en-GB')}
                </span>
              </div>
            </div>
            <div className="ticket-field">
              <span className="retro-font ticket-label">MESSAGE</span>
              <div className="retro-font ticket-message">{sub.message}</div>
            </div>
          </div>

          {/* 2 — what's being done about it. */}
          <div className="ticket-section">
            <div className="pixel-font ticket-section-title">TRIAGE</div>
            <div className="ticket-field">
              <span className="retro-font ticket-label">STATUS</span>
              <select
                className="form-select"
                value={resolving ? 'resolved' : sub.status}
                onChange={e => {
                  const next = e.target.value as Status
                  // Resolving doesn't save yet: it arms the closure code
                  // picker below, and the two go to the Worker together.
                  if (next === 'resolved') onArmResolve()
                  else onStatusChange(next)
                }}
              >
                {/* The system-assigned ends of the lifecycle (`new` on
                    arrival, `closed` by the sweep) appear only as the current
                    value, greyed out — picking anything else moves the ticket
                    on, or reopens it. */}
                {!SETTABLE_STATUSES.includes(sub.status) && (
                  <option value={sub.status} disabled>{STATUS_LABELS[sub.status]}</option>
                )}
                {SETTABLE_STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
              {!resolving && autoCloseNote(sub, now) && (
                <span className="retro-font ticket-hint">{autoCloseNote(sub, now)}</span>
              )}
              {!resolving && !carriesClosure && (
                <span className="retro-font ticket-hint">
                  resolve it to start the {AUTO_CLOSE_DAYS}-day close countdown
                </span>
              )}
            </div>

            {/* Closure code + note — armed by choosing "resolved" above, and
                each editable on its own afterwards so a wrong code or a thin
                note can be corrected without restarting the countdown. */}
            {resolving ? (
              <>
                <div className="ticket-field" ref={resolveBlock}>
                  <span className="retro-font ticket-label">CLOSURE CODE — REQUIRED</span>
                  <select
                    className="form-select"
                    value={pending.code}
                    autoFocus
                    onChange={e => onPendingChange({ ...pending, code: e.target.value as ClosureCode })}
                  >
                    <option value="">— why? —</option>
                    {SELECTABLE_CLOSURE_CODES.map(c => (
                      <option key={c} value={c}>{CLOSURE_CODE_LABELS[c]}</option>
                    ))}
                  </select>
                  <span className="retro-font ticket-hint">
                    {pending.code
                      ? CLOSURE_CODE_HINTS[pending.code]
                      : 'pick why this is done — it stays on the ticket'}
                  </span>
                </div>
                <div className="ticket-field">
                  <span className="retro-font ticket-label">CLOSURE NOTE (OPTIONAL)</span>
                  <textarea
                    className="form-textarea"
                    value={pending.note}
                    maxLength={CLOSURE_NOTE_MAX}
                    placeholder="what actually happened..."
                    onChange={e => onPendingChange({ ...pending, note: e.target.value })}
                  />
                  <div className="ticket-action-row">
                    <span className="retro-font ticket-hint">
                      {pending.note.length}/{CLOSURE_NOTE_MAX}
                    </span>
                    <button className="retro-font ticket-btn" onClick={onCancelResolve}>
                      cancel
                    </button>
                    <button
                      className="form-submit"
                      disabled={!pending.code || saving}
                      onClick={onConfirmResolve}
                      style={{ opacity: pending.code ? 1 : 0.4 }}
                    >
                      {saving ? '...' : 'RESOLVE →'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="ticket-field">
                  <span className="retro-font ticket-label">CLOSURE CODE</span>
                  <select
                    className="form-select"
                    value={sub.closureCode ?? ''}
                    disabled={!carriesClosure || saving}
                    onChange={e => onClosureCodeChange(e.target.value as ClosureCode)}
                    style={{ opacity: carriesClosure ? 1 : 0.5 }}
                  >
                    <option value="" disabled>—</option>
                    {SELECTABLE_CLOSURE_CODES.map(c => (
                      <option key={c} value={c}>{CLOSURE_CODE_LABELS[c]}</option>
                    ))}
                    {/* Backfilled on tickets resolved before codes existed. */}
                    {sub.closureCode === 'unspecified' && (
                      <option value="unspecified">{CLOSURE_CODE_LABELS.unspecified}</option>
                    )}
                  </select>
                  <span className="retro-font ticket-hint">
                    {sub.closureCode
                      ? CLOSURE_CODE_HINTS[sub.closureCode]
                      : 'set when you resolve the ticket'}
                  </span>
                </div>
                <div className="ticket-field">
                  <span className="retro-font ticket-label">CLOSURE NOTE</span>
                  <textarea
                    className="form-textarea"
                    value={closureNote}
                    maxLength={CLOSURE_NOTE_MAX}
                    disabled={!carriesClosure}
                    onChange={e => onClosureNoteChange(e.target.value)}
                    placeholder={carriesClosure
                      ? 'what actually happened...'
                      : 'written when you resolve it'}
                    style={{ opacity: carriesClosure ? 1 : 0.5 }}
                  />
                  <div className="ticket-action-row">
                    <span className="retro-font ticket-hint">
                      {closureNote.length}/{CLOSURE_NOTE_MAX}
                    </span>
                    <button
                      className="form-submit"
                      onClick={onSaveClosureNote}
                      disabled={!carriesClosure || saving}
                    >
                      {saving ? '...' : 'SAVE'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 3 — your own working notes, last because they're private. */}
          <div className="ticket-section">
            <div className="pixel-font ticket-section-title">INTERNAL NOTES</div>
            <div className="ticket-field">
              <textarea
                className="form-textarea"
                value={notes}
                onChange={e => onNotesChange(e.target.value)}
                placeholder="notes visible only to you..."
              />
              <div className="ticket-action-row">
                <span className="retro-font ticket-hint">never leaves the console</span>
                <button className="form-submit" onClick={onSaveNotes} disabled={saving}>
                  {saving ? '...' : 'SAVE'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Admin() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Default view: everything not resolved/closed.
  const [view, setView] = useState<View>('open')
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS })
  // Re-stamped on every load so the auto-close countdowns stay honest.
  const [now, setNow] = useState(() => Date.now())
  const [sortKey, setSortKey] = useState<ColKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // The ticket whose detail sheet is up, by ref — `null` when none is.
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  // Refs the user has ticked for bulk actions.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  // Refs mid-resolve: the status select is showing `resolved` but nothing is
  // saved until a closure code is chosen (`code: ''` = armed, none picked yet).
  const [pendingResolve, setPendingResolve] =
    useState<Record<string, { code: ClosureCode | ''; note: string }>>({})
  // Closure notes being edited on already-resolved tickets.
  const [editClosureNote, setEditClosureNote] = useState<Record<string, string>>({})

  const fetchSubmissions = useCallback(async (pw: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/admin/submissions`, {
        headers: { 'x-admin-password': pw },
      })
      if (res.status === 401) {
        sessionStorage.removeItem('admin-pw')
        setAuthed(false)
        setError('Wrong password.')
        return
      }
      if (!res.ok) throw new Error('Failed to load')
      const data = (await res.json()) as Submission[]
      // Statuses written by the old four-value system are rewritten by the
      // Worker's sweep, but normalise on read too so nothing can render an
      // unknown status or closure code.
      setSubmissions(data.map(s => ({
        ...s,
        status: normaliseStatus(s.status),
        closureCode: isClosureCode(s.closureCode) ? s.closureCode : null,
      })))
      setNow(Date.now())
      const notes: Record<string, string> = {}
      const closureNotes: Record<string, string> = {}
      data.forEach(s => {
        notes[s.ref] = s.notes ?? ''
        closureNotes[s.ref] = s.closureNote ?? ''
      })
      setEditNotes(notes)
      setEditClosureNote(closureNotes)
    } catch {
      setError('Failed to load submissions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem('admin-pw')
    if (saved) { setAuthed(true); fetchSubmissions(saved) }
  }, [fetchSubmissions])

  // While the sheet is up: escape closes it, and the page behind it stops
  // scrolling — otherwise a touch drag that misses the sheet scrolls the
  // table underneath and you lose your place.
  useEffect(() => {
    if (!openRef) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenRef(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [openRef])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    sessionStorage.setItem('admin-pw', password)
    setAuthed(true)
    fetchSubmissions(password)
  }

  // The status fields a local row takes on after a successful PATCH — the
  // same shape the Worker writes, so the row doesn't need a refetch to show
  // its auto-close countdown. Reopening drops the closure code and note,
  // exactly as the Worker does.
  function statusPatch(
    status: Status,
    closure: { code: ClosureCode | null; note: string | null },
    resolvedAt: string | null,
  ) {
    const done = status === 'resolved'
    return {
      status,
      closureCode: done ? closure.code : null,
      closureNote: done ? closure.note : null,
      resolvedAt: done ? (resolvedAt ?? new Date().toISOString()) : null,
      closedAt: null,
      autoClosed: null,
    }
  }

  function clearPendingResolve(ref: string) {
    setPendingResolve(p => {
      const next = { ...p }
      delete next[ref]
      return next
    })
  }

  /**
   * Resolving sends its closure code in the same request — the Worker insists —
   * along with the optional closure note.
   */
  async function updateStatus(
    ref: string,
    status: Status,
    closure?: { code: ClosureCode; note: string },
  ): Promise<boolean> {
    const pw = sessionStorage.getItem('admin-pw')!
    const res = await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify(
        status === 'resolved' && closure
          ? { status, closureCode: closure.code, closureNote: closure.note }
          : { status },
      ),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `Could not set ${ref} to ${statusLabel(status)}.`)
      return false
    }
    const body = (await res.json().catch(() => ({}))) as {
      resolvedAt?: string | null; closureNote?: string | null
    }
    setError('')
    setNow(Date.now())
    // The Worker trims and caps the note, so its version is the truth.
    const note = body.closureNote ?? null
    setSubmissions(s => s.map(sub =>
      sub.ref === ref
        ? {
            ...sub,
            ...statusPatch(status, { code: closure?.code ?? null, note }, body.resolvedAt ?? null),
          }
        : sub,
    ))
    setEditClosureNote(n => ({ ...n, [ref]: note ?? '' }))
    return true
  }

  /** Commits an armed resolve once a closure code has been chosen. */
  async function confirmResolve(ref: string) {
    const pending = pendingResolve[ref]
    if (!pending?.code) return
    setSaving(ref)
    const ok = await updateStatus(ref, 'resolved', { code: pending.code, note: pending.note })
    setSaving(null)
    // On failure the picker stays armed so it can be retried.
    if (ok) clearPendingResolve(ref)
  }

  /** Edits the closure note of an already-finished ticket, on its own. */
  async function saveClosureNote(ref: string) {
    setSaving(ref)
    const pw = sessionStorage.getItem('admin-pw')!
    const res = await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ closureNote: editClosureNote[ref] ?? '' }),
    })
    setSaving(null)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `Could not save the closure note on ${ref}.`)
      return
    }
    const body = (await res.json().catch(() => ({}))) as { closureNote?: string | null }
    setError('')
    const note = body.closureNote ?? null
    setSubmissions(s => s.map(sub => (sub.ref === ref ? { ...sub, closureNote: note } : sub)))
    setEditClosureNote(n => ({ ...n, [ref]: note ?? '' }))
  }

  /**
   * Corrects the closure code of an already-finished ticket on its own — no
   * status change, so the auto-close clock isn't restarted.
   */
  async function updateClosureCode(ref: string, closureCode: ClosureCode) {
    setSaving(ref)
    const pw = sessionStorage.getItem('admin-pw')!
    const res = await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ closureCode }),
    })
    setSaving(null)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `Could not set the closure code on ${ref}.`)
      return
    }
    setError('')
    setSubmissions(s => s.map(sub => (sub.ref === ref ? { ...sub, closureCode } : sub)))
  }

  async function bulkUpdateStatus(status: Status, closureCode?: ClosureCode) {
    const refs = [...selected]
    if (refs.length === 0) return
    setBulkSaving(true)
    const pw = sessionStorage.getItem('admin-pw')!
    // Bulk resolves carry the code but no note — a note is per-ticket, so
    // clear rather than leave a stale one behind.
    const payload = status === 'resolved'
      ? { status, closureCode, closureNote: '' }
      : { status }
    try {
      const results = await Promise.all(refs.map(async ref => {
        const res = await fetch(`${API}/admin/submissions/${ref}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
          body: JSON.stringify(payload),
        })
        return { ref, ok: res.ok }
      }))
      const updated = new Set(results.filter(r => r.ok).map(r => r.ref))
      const failed = results.filter(r => !r.ok).map(r => r.ref)
      const stamp = new Date().toISOString()
      setNow(Date.now())
      setSubmissions(s => s.map(sub =>
        updated.has(sub.ref)
          ? { ...sub, ...statusPatch(status, { code: closureCode ?? null, note: null }, stamp) }
          : sub,
      ))
      setError(failed.length ? `Could not update: ${failed.join(', ')}.` : '')
      setSelected(new Set(failed))
    } finally {
      setBulkSaving(false)
    }
  }

  async function saveNotes(ref: string) {
    setSaving(ref)
    const pw = sessionStorage.getItem('admin-pw')!
    await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ notes: editNotes[ref] }),
    })
    setSubmissions(s => s.map(sub => sub.ref === ref ? { ...sub, notes: editNotes[ref] } : sub))
    setSaving(null)
  }

  function setFilter(key: ColKey, value: string) {
    setFilters(f => ({ ...f, [key]: value }))
  }

  function toggleSort(key: ColKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'timestamp' ? 'desc' : 'asc')
    }
  }

  const activeFilterCount = Object.values(filters).filter(v => v.trim() !== '').length

  const filtered = useMemo(() => {
    const rows = submissions.filter(s =>
      inView(view, s.status) &&
      COLUMNS.every(c => {
        const raw = c.key === 'timestamp'
          ? new Date(s.timestamp).toLocaleDateString('en-GB')
          // Match STATUS/CLOSURE on what the table shows (the label), so
          // "*progress*" finds work-in-progress tickets and "won't" finds
          // wont-fix ones.
          : c.key === 'status' ? statusLabel(s.status)
          : c.key === 'closureCode' ? closureCodeLabel(s.closureCode)
          : String(s[c.key] ?? '')
        return matchesFilter(raw, filters[c.key])
      }),
    )
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'timestamp') {
        return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir
      }
      if (sortKey === 'status') {
        return ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)) * dir
      }
      if (sortKey === 'closureCode') {
        // Unresolved rows (no code) sort together at the bottom.
        const key = (s: Submission) => closureCodeLabel(s.closureCode) || '~'
        return key(a).localeCompare(key(b)) * dir
      }
      return String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? '')) * dir
    })
  }, [submissions, view, filters, sortKey, sortDir])

  const openSub = openRef ? submissions.find(s => s.ref === openRef) ?? null : null

  const allVisibleSelected = filtered.length > 0 && filtered.every(s => selected.has(s.ref))
  const someVisibleSelected = filtered.some(s => selected.has(s.ref))

  function toggleSelect(ref: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach(s => next.delete(s.ref))
      else filtered.forEach(s => next.add(s.ref))
      return next
    })
  }

  // Counts live on the view buttons rather than in a separate stat panel —
  // the two were doing the same job, and six tiles pushed the table off a
  // phone screen. `all` is the total; `open` is the aggregate.
  const viewCount = (v: View): number =>
    v === 'all' ? submissions.length
      : v === 'open' ? submissions.filter(s => isOpenStatus(s.status)).length
        : submissions.filter(s => s.status === v).length

  const viewColor = (v: View): string =>
    v === 'all' || v === 'open' ? 'var(--color-dark)' : STATUS_COLORS[v]

  const appCount = new Set(submissions.map(s => s.appId)).size

  if (!authed) {
    return (
      <main className="page-wrapper">
        <div className="hero pixel-box">
          <h1 className="hero-title pixel-font">admin</h1>
        </div>
        <form onSubmit={handleLogin} className="contact-form pixel-box" style={{ maxWidth: 400 }}>
          {error && <p className="retro-font" style={{ color: 'red', fontSize: 18 }}>{error}</p>}
          <div className="form-field">
            <label className="form-label pixel-font" htmlFor="pw">PASSWORD</label>
            <input
              className="form-input"
              type="password"
              id="pw"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              required
            />
          </div>
          <button className="form-submit" type="submit">ENTER →</button>
        </form>
      </main>
    )
  }

  return (
    <main className="page-wrapper">
      {/* Header */}
      <div className="admin-header">
        <div className="hero pixel-box" style={{ flex: 1 }}>
          <h1 className="hero-title pixel-font">fault console</h1>
          <p className="hero-sub retro-font">{submissions.length} tickets across {appCount} apps</p>
        </div>
        <div className="admin-header-actions">
          <button
            className="retro-font"
            onClick={() => fetchSubmissions(sessionStorage.getItem('admin-pw')!)}
            style={{ padding: '10px 18px', border: '3px solid var(--color-dark)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 20, boxShadow: '3px 3px 0 var(--color-dark)' }}
          >
            ↻ refresh
          </button>
          <button
            className="retro-font"
            onClick={() => { sessionStorage.removeItem('admin-pw'); setAuthed(false); setSubmissions([]) }}
            style={{ padding: '10px 18px', border: '3px solid var(--color-dark)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 20, boxShadow: '3px 3px 0 var(--color-dark)' }}
          >
            log out
          </button>
        </div>
      </div>

      {/* Toolbar: views (with their counts) + filter meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {VIEWS.map(v => {
              const active = view === v.v
              return (
                <button
                  key={v.v}
                  onClick={() => setView(v.v)}
                  className="retro-font"
                  title={v.v === 'open' ? 'everything not resolved or closed' : `status: ${v.label}`}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 6,
                    padding: '4px 10px', border: '2px solid var(--color-dark)',
                    fontSize: 17, cursor: 'pointer',
                    background: active ? 'var(--color-dark)' : 'var(--color-bg)',
                    color: active ? 'var(--color-card)' : 'var(--color-dark)',
                  }}
                >
                  {v.label}
                  {/* The count in the status colour, so the row reads as a
                      dashboard as well as a set of switches. */}
                  <span
                    className="pixel-font"
                    style={{
                      fontSize: 11,
                      color: active ? 'var(--color-card)' : viewColor(v.v),
                    }}
                  >
                    {viewCount(v.v)}
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="retro-font" style={{ fontSize: 17, color: 'var(--color-muted)' }}>
              showing {filtered.length} of {submissions.length}
            </span>
            <button
              onClick={() => setFilters({ ...EMPTY_FILTERS })}
              disabled={activeFilterCount === 0}
              className="retro-font"
              style={{
                padding: '6px 14px', border: '3px solid var(--color-dark)', fontSize: 17,
                background: 'var(--color-bg)', cursor: activeFilterCount ? 'pointer' : 'default',
                opacity: activeFilterCount ? 1 : 0.4,
              }}
            >
              clear filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
          </div>
        </div>
        {/* No explainer text above the table. The lifecycle rules are enforced
            by the controls themselves, and the wildcard filter syntax is
            surfaced on the inputs (placeholder + tooltip) rather than in a
            paragraph nobody re-reads. Both are written up in
            docs/feedback-how-it-works.md. */}
      </div>

      {/* Bulk action bar — appears once rows are ticked */}
      {selected.size > 0 && (
        <div
          className="pixel-box"
          style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px' }}
        >
          <span className="retro-font" style={{ fontSize: 19, fontWeight: 'bold' }}>
            {selected.size} selected
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="retro-font" style={{ fontSize: 17, color: 'var(--color-muted)' }}>set status →</span>
            {/* No `closed` button — closing is the auto-close sweep's job. */}
            {SETTABLE_STATUSES.filter(s => s !== 'resolved').map(s => (
              <button
                key={s}
                onClick={() => bulkUpdateStatus(s)}
                disabled={bulkSaving}
                className="retro-font"
                style={{
                  padding: '6px 14px', border: `3px solid ${STATUS_COLORS[s]}`, fontSize: 17,
                  background: 'var(--color-bg)', color: STATUS_COLORS[s],
                  cursor: bulkSaving ? 'default' : 'pointer', opacity: bulkSaving ? 0.5 : 1,
                }}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
            {/* Resolving needs a reason, so it's a code picker rather than a
                button — picking one resolves the whole selection with it. */}
            <select
              className="retro-font"
              value=""
              disabled={bulkSaving}
              onChange={e => {
                const code = e.target.value as ClosureCode
                e.target.value = ''
                if (code) bulkUpdateStatus('resolved', code)
              }}
              style={{
                padding: '6px 10px', border: `3px solid ${STATUS_COLORS.resolved}`, fontSize: 17,
                background: 'var(--color-bg)', color: STATUS_COLORS.resolved,
                fontFamily: 'var(--font-retro), monospace',
                cursor: bulkSaving ? 'default' : 'pointer', opacity: bulkSaving ? 0.5 : 1,
              }}
            >
              <option value="">resolve as…</option>
              {SELECTABLE_CLOSURE_CODES.map(c => (
                <option key={c} value={c} title={CLOSURE_CODE_HINTS[c]}>{CLOSURE_CODE_LABELS[c]}</option>
              ))}
            </select>
          </div>
          {bulkSaving && <span className="retro-font" style={{ fontSize: 17 }}>saving…</span>}
          <button
            onClick={() => setSelected(new Set())}
            disabled={bulkSaving}
            className="retro-font"
            style={{
              marginLeft: 'auto', padding: '6px 14px', border: '3px solid var(--color-dark)',
              fontSize: 17, background: 'var(--color-bg)', cursor: bulkSaving ? 'default' : 'pointer',
            }}
          >
            clear selection
          </button>
        </div>
      )}

      {loading && <p className="retro-font" style={{ fontSize: 22, color: 'var(--color-muted)' }}>loading...</p>}
      {error && <p className="retro-font" style={{ fontSize: 20, color: 'red' }}>{error}</p>}

      {/* Fault table */}
      <div className="pixel-box" style={{ overflowX: 'auto', padding: 0 }}>
        <div style={{ minWidth: GRID_MIN_WIDTH }}>
          {/* Header row */}
          <div
            style={{
              display: 'grid', gridTemplateColumns: GRID_TEMPLATE,
              background: 'var(--color-dark)', color: 'var(--color-card)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={el => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected }}
                onChange={toggleSelectAllVisible}
                title="select all shown"
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
            </span>
            {COLUMNS.map(c => {
              const active = sortKey === c.key
              return (
                <button
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="pixel-font"
                  style={{
                    fontSize: 8, lineHeight: 1.4, textAlign: 'left', padding: '12px 12px 10px',
                    background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                  }}
                  title={`sort by ${c.label.toLowerCase()}`}
                >
                  {c.label}
                  <span style={{ opacity: active ? 1 : 0.3, fontSize: 9 }}>
                    {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </button>
              )
            })}
            <span />
          </div>

          {/* Filter row */}
          <div
            style={{
              display: 'grid', gridTemplateColumns: GRID_TEMPLATE,
              borderBottom: '3px solid var(--color-dark)', background: '#ede8dc',
            }}
          >
            <span />
            {COLUMNS.map(c => (
              <div key={c.key} style={{ padding: '7px 8px' }}>
                <input
                  value={filters[c.key]}
                  onChange={e => setFilter(c.key, e.target.value)}
                  placeholder="filter *"
                  // Carries the wildcard hint that used to be a paragraph above
                  // the table — available where it's used, invisible until then.
                  title={`filter ${c.label.toLowerCase()} — * is a wildcard (WDA-*, *dark mode*)`}
                  className="retro-font"
                  style={{
                    width: '100%', fontSize: 15, padding: '5px 7px',
                    border: '2px solid var(--color-dark)', background: 'var(--color-card)',
                    color: 'var(--color-dark)', outline: 'none',
                    fontFamily: 'var(--font-retro), monospace',
                  }}
                />
              </div>
            ))}
            <span />
          </div>

          {/* Data rows */}
          {!loading && filtered.length === 0 && (
            <p className="retro-font" style={{ fontSize: 20, color: 'var(--color-muted)', padding: '22px 16px' }}>
              no tickets in the <strong>{VIEWS.find(v => v.v === view)?.label ?? view}</strong> view
              {activeFilterCount ? ' match the current filters' : ''}
            </p>
          )}
          {filtered.map((sub, i) => {
            const isOpen = openRef === sub.ref
            return (
              <div
                key={sub.ref}
                style={{ borderBottom: '2px solid rgba(44,44,58,0.18)' }}
              >
                {/* Summary row — tapping it opens the detail sheet. */}
                <div
                  onClick={() => setOpenRef(isOpen ? null : sub.ref)}
                  style={{
                    display: 'grid', gridTemplateColumns: GRID_TEMPLATE, alignItems: 'center',
                    cursor: 'pointer',
                    background: isOpen ? '#ede8dc' : (i % 2 ? 'rgba(44,44,58,0.03)' : 'transparent'),
                  }}
                >
                  <span
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 0' }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(sub.ref)}
                      onChange={() => toggleSelect(sub.ref)}
                      title="select ticket"
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                  </span>
                  <span className="retro-font" style={{ padding: '11px 12px', fontSize: 16, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                    {sub.ref}
                  </span>
                  <span style={{ padding: '11px 12px', whiteSpace: 'nowrap' }} title={autoCloseNote(sub, now) || undefined}>
                    <span
                      className="retro-font"
                      style={{
                        fontSize: 14, fontWeight: 'bold', color: statusColor(sub.status),
                        borderBottom: `2px solid ${statusColor(sub.status)}`,
                        paddingBottom: 1,
                      }}
                    >
                      {statusLabel(sub.status)}
                    </span>
                    {/* Days left before this resolved ticket auto-closes. */}
                    {sub.status === 'resolved' && daysUntilAutoClose(sub.resolvedAt, now) !== null && (
                      <span className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginLeft: 6 }}>
                        ·{daysUntilAutoClose(sub.resolvedAt, now)}d
                      </span>
                    )}
                  </span>
                  <span className="retro-font" style={{ padding: '11px 12px', fontSize: 16, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                    {sub.type}
                  </span>
                  <span className="retro-font" style={{ padding: '11px 12px', fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub.appId}
                  </span>
                  <span className="retro-font" style={{ padding: '11px 12px', fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub.name}
                  </span>
                  <span className="retro-font" style={{ padding: '11px 12px', fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub.message}
                  </span>
                  <span className="retro-font" style={{ padding: '11px 12px', fontSize: 15, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(sub.timestamp).toLocaleDateString('en-GB')}
                  </span>
                  <span
                    className="retro-font"
                    title={sub.closureCode
                      // The note is the useful part when there is one.
                      ? sub.closureNote ?? CLOSURE_CODE_HINTS[sub.closureCode]
                      : 'not resolved yet'}
                    style={{
                      padding: '11px 12px', fontSize: 15, color: 'var(--color-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {closureCodeLabel(sub.closureCode) || '—'}
                  </span>
                  <span
                    className="retro-font"
                    title="open ticket"
                    style={{
                      padding: '11px 8px', fontSize: 20, textAlign: 'center',
                      color: isOpen ? 'var(--color-dark)' : 'var(--color-muted)',
                    }}
                  >
                    ›
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Ticket detail — rendered here, outside the table's horizontal
          scroller, so it's sized by the viewport rather than by the grid's
          min-width. Looked up in `submissions` rather than `filtered` so
          resolving a ticket from the `open` view doesn't yank the sheet out
          from under you the moment it stops matching. */}
      {openSub && (
        <TicketSheet
          sub={openSub}
          now={now}
          saving={saving === openSub.ref}
          pending={pendingResolve[openSub.ref]}
          notes={editNotes[openSub.ref] ?? ''}
          closureNote={editClosureNote[openSub.ref] ?? ''}
          onClose={() => setOpenRef(null)}
          onStatusChange={status => {
            clearPendingResolve(openSub.ref)
            updateStatus(openSub.ref, status)
          }}
          onArmResolve={() => setPendingResolve(p => ({
            ...p,
            [openSub.ref]: { code: openSub.closureCode ?? '', note: openSub.closureNote ?? '' },
          }))}
          onPendingChange={pending => setPendingResolve(p => ({ ...p, [openSub.ref]: pending }))}
          onConfirmResolve={() => confirmResolve(openSub.ref)}
          onCancelResolve={() => clearPendingResolve(openSub.ref)}
          onClosureCodeChange={code => updateClosureCode(openSub.ref, code)}
          onClosureNoteChange={note => setEditClosureNote(n => ({ ...n, [openSub.ref]: note }))}
          onSaveClosureNote={() => saveClosureNote(openSub.ref)}
          onNotesChange={notes => setEditNotes(n => ({ ...n, [openSub.ref]: notes }))}
          onSaveNotes={() => saveNotes(openSub.ref)}
        />
      )}
    </main>
  )
}
