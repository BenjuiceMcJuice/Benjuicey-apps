'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

const API = process.env.NEXT_PUBLIC_FEEDBACK_API_URL!

interface Submission {
  ref: string
  appId: string
  trigram: string
  type: string
  status: string
  name: string
  email: string
  message: string
  timestamp: string
  notes: string
}

const STATUS_COLORS: Record<string, string> = {
  open: '#e74c3c',
  'in-progress': '#f39c12',
  done: '#27ae60',
  'wont-fix': '#95a5a6',
}

const STATUS_OPTIONS = ['open', 'in-progress', 'done', 'wont-fix']
const STATUS_ORDER = STATUS_OPTIONS.reduce<Record<string, number>>(
  (acc, s, i) => ({ ...acc, [s]: i }),
  {},
)

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'var(--color-muted)'
}

// ─── column definitions for the fault table ──────────────────────────
// key = field on Submission, label = header, flex = grid track sizing.
type ColKey = 'ref' | 'status' | 'type' | 'appId' | 'name' | 'message' | 'timestamp'

interface Column {
  key: ColKey
  label: string
  track: string
}

const COLUMNS: Column[] = [
  { key: 'ref', label: 'REF', track: 'minmax(96px, 0.9fr)' },
  { key: 'status', label: 'STATUS', track: '110px' },
  { key: 'type', label: 'TYPE', track: '92px' },
  { key: 'appId', label: 'APP', track: 'minmax(110px, 1fr)' },
  { key: 'name', label: 'FROM', track: 'minmax(110px, 1fr)' },
  { key: 'message', label: 'SUBJECT', track: 'minmax(180px, 2.4fr)' },
  { key: 'timestamp', label: 'LOGGED', track: '104px' },
]

// Leading 36px track = row-selection checkbox; trailing 34px = expand chevron.
const GRID_TEMPLATE = '36px ' + COLUMNS.map(c => c.track).join(' ') + ' 34px'
const GRID_MIN_WIDTH = 976

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

type Filters = Record<ColKey, string>
const EMPTY_FILTERS: Filters = {
  ref: '', status: '', type: '', appId: '', name: '', message: '', timestamp: '',
}

// Value a column filters/sorts on — timestamps compare as rendered dates.
function cellValue(sub: Submission, key: ColKey): string {
  if (key === 'timestamp') return new Date(sub.timestamp).toLocaleDateString('en-GB')
  return String(sub[key] ?? '')
}

function shortDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export default function Admin() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Default view: OPEN tickets only.
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, status: 'open' })
  // Free-text search across every column — the phone layout's filter row.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<ColKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [savingRef, setSavingRef] = useState<string | null>(null)
  // Refs the user has ticked for bulk actions.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)

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
      setSubmissions(data)
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

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    sessionStorage.setItem('admin-pw', password)
    setAuthed(true)
    fetchSubmissions(password)
  }

  // One PATCH for whatever the modal changed (status and/or notes).
  async function saveTicket(ref: string, updates: { status?: string; notes?: string }) {
    if (Object.keys(updates).length === 0) return
    setSavingRef(ref)
    const pw = sessionStorage.getItem('admin-pw')!
    try {
      const res = await fetch(`${API}/admin/submissions/${ref}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('save failed')
      setSubmissions(s => s.map(sub => (sub.ref === ref ? { ...sub, ...updates } : sub)))
    } finally {
      setSavingRef(null)
    }
  }

  async function bulkUpdateStatus(status: string) {
    const refs = [...selected]
    if (refs.length === 0) return
    setBulkSaving(true)
    const pw = sessionStorage.getItem('admin-pw')!
    const refSet = new Set(refs)
    try {
      await Promise.all(refs.map(ref =>
        fetch(`${API}/admin/submissions/${ref}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
          body: JSON.stringify({ status }),
        }),
      ))
      setSubmissions(s => s.map(sub => (refSet.has(sub.ref) ? { ...sub, status } : sub)))
      setSelected(new Set())
    } finally {
      setBulkSaving(false)
    }
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

  function clearAllFilters() {
    setFilters({ ...EMPTY_FILTERS })
    setQuery('')
  }

  const activeFilterCount =
    Object.values(filters).filter(v => v.trim() !== '').length + (query.trim() ? 1 : 0)

  const filtered = useMemo(() => {
    const q = query.trim()
    const rows = submissions.filter(s => {
      if (!COLUMNS.every(c => matchesFilter(cellValue(s, c.key), filters[c.key]))) return false
      if (!q) return true
      // Search hits any column, plus the email which has no column of its own.
      return (
        COLUMNS.some(c => matchesFilter(cellValue(s, c.key), q)) ||
        matchesFilter(s.email ?? '', q)
      )
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'timestamp') {
        return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir
      }
      if (sortKey === 'status') {
        return ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)) * dir
      }
      return String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? '')) * dir
    })
  }, [submissions, filters, query, sortKey, sortDir])

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

  // Ticket count per status ('' = all) — shown on the filter chips, which
  // stand in for the stat tiles on phones.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { '': submissions.length }
    STATUS_OPTIONS.forEach(s => { counts[s] = 0 })
    submissions.forEach(s => { counts[s.status] = (counts[s.status] ?? 0) + 1 })
    return counts
  }, [submissions])

  const stats = [
    { label: 'total', value: submissions.length, color: 'var(--color-dark)', status: '' },
    { label: 'open', value: submissions.filter(s => s.status === 'open').length, color: '#e74c3c', status: 'open' },
    { label: 'in progress', value: submissions.filter(s => s.status === 'in-progress').length, color: '#f39c12', status: 'in-progress' },
    { label: 'done', value: submissions.filter(s => s.status === 'done').length, color: '#27ae60', status: 'done' },
  ]

  const appCount = new Set(submissions.map(s => s.appId)).size

  // The open ticket is read from the full list, not the filtered one — marking
  // a ticket "done" while filtered to "open" shouldn't slam the sheet shut
  // mid-edit. Its place in the filtered list (if it still has one) only drives
  // the prev/next walk.
  const openTicket = openRef ? submissions.find(s => s.ref === openRef) ?? null : null
  const openIndex = openRef ? filtered.findIndex(s => s.ref === openRef) : -1

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
    <main className="page-wrapper admin-page">
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
            style={{ padding: '10px 18px', minHeight: 44, border: '3px solid var(--color-dark)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 20, boxShadow: '3px 3px 0 var(--color-dark)' }}
          >
            ↻ refresh
          </button>
          <button
            className="retro-font"
            onClick={() => { sessionStorage.removeItem('admin-pw'); setAuthed(false); setSubmissions([]) }}
            style={{ padding: '10px 18px', minHeight: 44, border: '3px solid var(--color-dark)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 20, boxShadow: '3px 3px 0 var(--color-dark)' }}
          >
            log out
          </button>
        </div>
      </div>

      {/* Stats — each tile is also the quickest way to filter by that status */}
      <div className="admin-stats">
        {stats.map(s => (
          <button
            key={s.label}
            className="pixel-box admin-stat"
            aria-pressed={filters.status === s.status}
            onClick={() => setFilter('status', s.status)}
            title={s.status ? `show ${s.status} tickets` : 'show all tickets'}
          >
            <div className="admin-stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="admin-stat-label">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Toolbar: status presets, search (phones), filter meta */}
      <div className="admin-toolbar">
        <div className="admin-toolbar-row">
          <div className="admin-chip-row">
            {[{ v: '', label: 'all' }, ...STATUS_OPTIONS.map(s => ({ v: s, label: s }))].map(s => (
              <button
                key={s.label}
                onClick={() => setFilter('status', s.v)}
                className="admin-chip"
                aria-pressed={filters.status === s.v}
              >
                {s.label} <span className="admin-chip-count">{statusCounts[s.v] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="admin-chip-row">
            <span className="admin-meta">showing {filtered.length} of {submissions.length}</span>
            <button
              onClick={clearAllFilters}
              disabled={activeFilterCount === 0}
              className="admin-chip"
            >
              clear filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
          </div>
        </div>

        {/* Phone controls — one search box + sort, instead of 7 column filters */}
        <div className="admin-mobile-controls">
          <div className="admin-search-wrap">
            <input
              className="admin-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="search tickets — * works as a wildcard"
              type="search"
              inputMode="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="search tickets"
            />
            {query && (
              <button className="admin-search-clear" onClick={() => setQuery('')} aria-label="clear search">
                ✕
              </button>
            )}
          </div>
          <div className="admin-sort-row">
            <select
              className="admin-sort-select"
              value={sortKey}
              onChange={e => setSortKey(e.target.value as ColKey)}
              aria-label="sort by"
            >
              {COLUMNS.map(c => (
                <option key={c.key} value={c.key}>sort: {c.label.toLowerCase()}</option>
              ))}
            </select>
            <button
              className="admin-sort-dir"
              onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              aria-label={sortDir === 'asc' ? 'sort ascending' : 'sort descending'}
            >
              {sortDir === 'asc' ? '▲' : '▼'}
            </button>
          </div>
        </div>

        <p className="retro-font admin-desktop-only" style={{ fontSize: 16, color: 'var(--color-muted)' }}>
          tip: filter any column — use <strong>*</strong> as a wildcard (e.g. <code>WDA-*</code>, <code>*dark mode*</code>). click a header to sort.
        </p>
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
          <div className="admin-chip-row">
            <span className="admin-meta">set status →</span>
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => bulkUpdateStatus(s)}
                disabled={bulkSaving}
                className="admin-chip"
                style={{ borderColor: STATUS_COLORS[s], color: STATUS_COLORS[s] }}
              >
                {s}
              </button>
            ))}
          </div>
          {bulkSaving && <span className="admin-meta">saving…</span>}
          <button
            onClick={() => setSelected(new Set())}
            disabled={bulkSaving}
            className="admin-chip"
            style={{ marginLeft: 'auto' }}
          >
            clear selection
          </button>
        </div>
      )}

      {loading && <p className="retro-font" style={{ fontSize: 22, color: 'var(--color-muted)' }}>loading...</p>}
      {error && <p className="retro-font" style={{ fontSize: 20, color: 'red' }}>{error}</p>}

      {/* ─── Phone layout: one tappable card per ticket ─── */}
      <div className="admin-card-list">
        {!loading && filtered.length === 0 && (
          <p className="admin-empty">no tickets match the current filters</p>
        )}
        {filtered.map(sub => (
          <div key={sub.ref} className={`ticket-card${selected.has(sub.ref) ? ' is-selected' : ''}`}>
            <label className="ticket-card-check" aria-label={`select ${sub.ref}`}>
              <input
                type="checkbox"
                checked={selected.has(sub.ref)}
                onChange={() => toggleSelect(sub.ref)}
              />
            </label>
            <button className="ticket-card-main" onClick={() => setOpenRef(sub.ref)}>
              <span className="ticket-card-top">
                <span className="ticket-card-ref">{sub.ref}</span>
                <span className="ticket-status" style={{ color: statusColor(sub.status) }}>
                  {sub.status}
                </span>
              </span>
              <span className="ticket-card-meta">
                {sub.appId} · {sub.type} · {shortDate(sub.timestamp)}
                {sub.name ? ` · ${sub.name}` : ''}
              </span>
              <span className="ticket-card-msg">{sub.message}</span>
            </button>
          </div>
        ))}
      </div>

      {/* ─── Desktop layout: the fault table ─── */}
      <div className="pixel-box admin-desktop-only" style={{ overflowX: 'auto', padding: 0 }}>
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
                  className="retro-font"
                  style={{
                    width: '100%', fontSize: 16, padding: '5px 7px',
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
            <p className="admin-empty">no tickets match the current filters</p>
          )}
          {filtered.map((sub, i) => (
            <div
              key={sub.ref}
              onClick={() => setOpenRef(sub.ref)}
              style={{
                display: 'grid', gridTemplateColumns: GRID_TEMPLATE, alignItems: 'center',
                cursor: 'pointer', borderBottom: '2px solid rgba(44,44,58,0.18)',
                background: i % 2 ? 'rgba(44,44,58,0.03)' : 'transparent',
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
              <span style={{ padding: '11px 12px', whiteSpace: 'nowrap' }}>
                <span
                  className="retro-font"
                  style={{
                    fontSize: 14, fontWeight: 'bold', color: statusColor(sub.status),
                    borderBottom: `2px solid ${statusColor(sub.status)}`, paddingBottom: 1,
                  }}
                >
                  {sub.status}
                </span>
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
              <span style={{ padding: '11px 8px', color: 'var(--color-muted)', textAlign: 'center' }}>›</span>
            </div>
          ))}
        </div>
      </div>

      {openTicket && (
        <TicketModal
          key={openTicket.ref}
          sub={openTicket}
          position={openIndex >= 0 ? { index: openIndex, total: filtered.length } : null}
          saving={savingRef === openTicket.ref}
          onSave={updates => saveTicket(openTicket.ref, updates)}
          onClose={() => setOpenRef(null)}
          onStep={delta => {
            const next = filtered[openIndex + delta]
            if (next) setOpenRef(next.ref)
          }}
        />
      )}
    </main>
  )
}

// ─── ticket modal ────────────────────────────────────────────────────
// Full detail + an editable form (status, internal notes) in one place.
// Edits are drafted locally and committed with SAVE, so a mis-tap on a
// phone can't silently re-status a ticket.
function TicketModal({
  sub, position, saving, onSave, onClose, onStep,
}: {
  sub: Submission
  // null once the ticket has dropped out of the filtered list (e.g. it was
  // just marked done while the view is filtered to open).
  position: { index: number; total: number } | null
  saving: boolean
  onSave: (updates: { status?: string; notes?: string }) => Promise<void>
  onClose: () => void
  onStep: (delta: number) => void
}) {
  const [status, setStatus] = useState(sub.status)
  const [notes, setNotes] = useState(sub.notes ?? '')
  const [saveError, setSaveError] = useState('')
  // Action held back until the user resolves unsaved edits.
  const [pending, setPending] = useState<null | (() => void)>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const dirty = status !== sub.status || notes !== (sub.notes ?? '')

  const changes = () => {
    const updates: { status?: string; notes?: string } = {}
    if (status !== sub.status) updates.status = status
    if (notes !== (sub.notes ?? '')) updates.notes = notes
    return updates
  }

  // Ask before throwing away edits; otherwise just do the thing.
  function guard(action: () => void) {
    if (dirty) setPending(() => action)
    else action()
  }

  async function save(then?: () => void) {
    setSaveError('')
    try {
      await onSave(changes())
      setPending(null)
      then?.()
    } catch {
      setSaveError('save failed — try again')
    }
  }

  // iOS Safari ignores `overflow: hidden` on <body>, so pin the page in
  // place and restore the scroll position when the sheet closes.
  useEffect(() => {
    const y = window.scrollY
    const { body } = document
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width }
    body.style.position = 'fixed'
    body.style.top = `-${y}px`
    body.style.width = '100%'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      window.scrollTo(0, y)
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') guard(onClose)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => { panelRef.current?.focus() }, [])

  const canPrev = position !== null && position.index > 0
  const canNext = position !== null && position.index < position.total - 1

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) guard(onClose) }}
    >
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`ticket ${sub.ref}`}
        tabIndex={-1}
        style={{ outline: 'none' }}
      >
        <div className="modal-head">
          <span className="modal-title">{sub.ref}</span>
          <button
            className="modal-nav-btn"
            onClick={() => guard(() => onStep(-1))}
            disabled={!canPrev}
            aria-label="previous ticket"
          >
            ‹
          </button>
          <button
            className="modal-nav-btn"
            onClick={() => guard(() => onStep(1))}
            disabled={!canNext}
            aria-label="next ticket"
          >
            ›
          </button>
          <button className="modal-close" onClick={() => guard(onClose)} aria-label="close">✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-facts">
            <div>
              <div className="modal-label">APP</div>
              <div className="modal-value">{sub.appId} ({sub.trigram})</div>
            </div>
            <div>
              <div className="modal-label">TYPE</div>
              <div className="modal-value">{sub.type}</div>
            </div>
            <div>
              <div className="modal-label">LOGGED</div>
              <div className="modal-value">{new Date(sub.timestamp).toLocaleString('en-GB')}</div>
            </div>
            <div>
              <div className="modal-label">FROM</div>
              <div className="modal-value">
                {sub.name || 'anonymous'}
                {sub.email ? (
                  <>
                    {' — '}
                    <a href={`mailto:${sub.email}?subject=Re: ${sub.ref}`} style={{ textDecoration: 'underline' }}>
                      {sub.email}
                    </a>
                  </>
                ) : ' (no email)'}
              </div>
            </div>
          </div>

          <div>
            <div className="modal-label">MESSAGE</div>
            <div className="modal-message">{sub.message}</div>
          </div>

          <div>
            <div className="modal-label">STATUS</div>
            <div className="modal-status-row">
              {STATUS_OPTIONS.map(s => {
                const active = status === s
                return (
                  <button
                    key={s}
                    className="modal-status-btn"
                    aria-pressed={active}
                    onClick={() => setStatus(s)}
                    style={{
                      color: STATUS_COLORS[s],
                      background: active ? STATUS_COLORS[s] : 'var(--color-bg)',
                    }}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="modal-label" htmlFor="ticket-notes">INTERNAL NOTES</label>
            <textarea
              id="ticket-notes"
              className="modal-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="notes visible only to you…"
              rows={3}
            />
          </div>
        </div>

        <div className="modal-foot">
          {saveError ? (
            <span className="modal-foot-note" style={{ color: '#e74c3c' }}>{saveError}</span>
          ) : pending ? (
            <span className="modal-foot-note" style={{ color: '#e74c3c' }}>unsaved changes</span>
          ) : (
            <span className="modal-foot-note">
              {dirty
                ? 'unsaved changes'
                : position
                  ? `ticket ${position.index + 1} of ${position.total}`
                  : 'saved — no longer matches the filter'}
            </span>
          )}

          <div className="modal-foot-actions">
            {pending && (
              <button
                className="modal-btn"
                onClick={() => { const go = pending; setPending(null); go() }}
                disabled={saving}
              >
                discard
              </button>
            )}
            <button
              className="modal-btn"
              onClick={() => (pending ? setPending(null) : guard(onClose))}
              disabled={saving}
            >
              {pending ? 'keep editing' : 'close'}
            </button>
            <button
              className="modal-btn modal-btn-primary"
              onClick={() => save(pending ?? undefined)}
              disabled={!dirty || saving}
            >
              {saving ? 'saving…' : 'save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
