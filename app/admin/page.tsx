'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AUTO_CLOSE_DAYS,
  OPEN_STATUSES,
  SETTABLE_STATUSES,
  STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  Status,
  autoCloseDueAt,
  daysUntilAutoClose,
  isOpenStatus,
  normaliseStatus,
  statusColor,
  statusLabel,
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
type ColKey = 'ref' | 'status' | 'type' | 'appId' | 'name' | 'message' | 'timestamp'

interface Column {
  key: ColKey
  label: string
  track: string
}

const COLUMNS: Column[] = [
  { key: 'ref', label: 'REF', track: 'minmax(96px, 0.9fr)' },
  // Wide enough for "work in progress" plus a resolved row's ·Nd countdown.
  { key: 'status', label: 'STATUS', track: '168px' },
  { key: 'type', label: 'TYPE', track: '92px' },
  { key: 'appId', label: 'APP', track: 'minmax(110px, 1fr)' },
  { key: 'name', label: 'FROM', track: 'minmax(110px, 1fr)' },
  { key: 'message', label: 'SUBJECT', track: 'minmax(180px, 2.4fr)' },
  { key: 'timestamp', label: 'LOGGED', track: '104px' },
]

// Leading 36px track = row-selection checkbox; trailing 34px = expand chevron.
const GRID_TEMPLATE = '36px ' + COLUMNS.map(c => c.track).join(' ') + ' 34px'
const GRID_MIN_WIDTH = 1034

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
  sub: { status: Status; resolvedAt: string | null; closedAt: string | null; autoClosed: boolean | null },
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
    return sub.closedAt ? `${how} on ${new Date(sub.closedAt).toLocaleDateString('en-GB')}` : how
  }
  return ''
}

type Filters = Record<ColKey, string>
const EMPTY_FILTERS: Filters = {
  ref: '', status: '', type: '', appId: '', name: '', message: '', timestamp: '',
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
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
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
      // Statuses written by the old four-value system are rewritten by the
      // Worker's sweep, but normalise on read too so nothing can render an
      // unknown status.
      setSubmissions(data.map(s => ({ ...s, status: normaliseStatus(s.status) })))
      setNow(Date.now())
      const notes: Record<string, string> = {}
      data.forEach(s => { notes[s.ref] = s.notes ?? '' })
      setEditNotes(notes)
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

  // The status fields a local row takes on after a successful PATCH — the
  // same shape the Worker writes, so the row doesn't need a refetch to show
  // its auto-close countdown.
  function statusPatch(status: Status, resolvedAt: string | null) {
    return {
      status,
      resolvedAt: status === 'resolved' ? (resolvedAt ?? new Date().toISOString()) : null,
      closedAt: null,
      autoClosed: null,
    }
  }

  async function updateStatus(ref: string, status: Status) {
    const pw = sessionStorage.getItem('admin-pw')!
    const res = await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? `Could not set ${ref} to ${statusLabel(status)}.`)
      return
    }
    const body = (await res.json().catch(() => ({}))) as { resolvedAt?: string | null }
    setError('')
    setNow(Date.now())
    setSubmissions(s => s.map(sub =>
      sub.ref === ref ? { ...sub, ...statusPatch(status, body.resolvedAt ?? null) } : sub,
    ))
  }

  async function bulkUpdateStatus(status: Status) {
    const refs = [...selected]
    if (refs.length === 0) return
    setBulkSaving(true)
    const pw = sessionStorage.getItem('admin-pw')!
    try {
      const results = await Promise.all(refs.map(async ref => {
        const res = await fetch(`${API}/admin/submissions/${ref}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
          body: JSON.stringify({ status }),
        })
        return { ref, ok: res.ok }
      }))
      const updated = new Set(results.filter(r => r.ok).map(r => r.ref))
      const failed = results.filter(r => !r.ok).map(r => r.ref)
      const stamp = new Date().toISOString()
      setNow(Date.now())
      setSubmissions(s => s.map(sub =>
        updated.has(sub.ref) ? { ...sub, ...statusPatch(status, stamp) } : sub,
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
          // Match the STATUS column on what the table shows (the label), so
          // "*progress*" finds work-in-progress tickets.
          : c.key === 'status' ? statusLabel(s.status)
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
      return String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? '')) * dir
    })
  }, [submissions, view, filters, sortKey, sortDir])

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

  // Tiles double as view switches. "open" is the aggregate (new + work in
  // progress + pending); `closed` has no tile — it lives behind its view.
  const count = (s: Status) => submissions.filter(sub => sub.status === s).length
  const stats: { label: string; value: number; color: string; view: View }[] = [
    { label: 'total', value: submissions.length, color: 'var(--color-dark)', view: 'all' },
    {
      label: 'open',
      value: submissions.filter(s => isOpenStatus(s.status)).length,
      color: 'var(--color-dark)',
      view: 'open',
    },
    ...OPEN_STATUSES.map(s => ({
      label: STATUS_LABELS[s], value: count(s), color: STATUS_COLORS[s], view: s as View,
    })),
    { label: 'resolved', value: count('resolved'), color: STATUS_COLORS.resolved, view: 'resolved' },
  ]

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

      {/* Stats — each tile is also a shortcut to that view */}
      <div className="admin-stats">
        {stats.map(s => (
          <button
            key={s.label}
            onClick={() => setView(s.view)}
            className="pixel-box"
            title={`show ${s.label}`}
            style={{
              padding: '16px 20px', textAlign: 'center', cursor: 'pointer',
              outline: view === s.view ? '3px solid var(--color-dark)' : 'none',
              outlineOffset: 2,
            }}
          >
            <div className="pixel-font" style={{ fontSize: 22, color: s.color, marginBottom: 8 }}>{s.value}</div>
            <div className="retro-font" style={{ fontSize: 18, color: 'var(--color-muted)' }}>{s.label}</div>
          </button>
        ))}
      </div>

      {/* Toolbar: views + filter meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {VIEWS.map(v => (
              <button
                key={v.v}
                onClick={() => setView(v.v)}
                className="retro-font"
                title={v.v === 'open' ? 'everything not resolved or closed' : `status: ${v.label}`}
                style={{
                  padding: '6px 14px', border: '3px solid var(--color-dark)', fontSize: 18, cursor: 'pointer',
                  background: view === v.v ? 'var(--color-dark)' : 'var(--color-bg)',
                  color: view === v.v ? 'var(--color-card)' : 'var(--color-dark)',
                }}
              >
                {v.label}
              </button>
            ))}
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
        <p className="retro-font" style={{ fontSize: 16, color: 'var(--color-muted)' }}>
          tip: filter any column — use <strong>*</strong> as a wildcard (e.g. <code>WDA-*</code>, <code>*dark mode*</code>). click a header to sort.
        </p>
        <p className="retro-font" style={{ fontSize: 16, color: 'var(--color-muted)' }}>
          workflow: <strong>new → work in progress → resolved</strong> (<strong>pending</strong> while
          you&apos;re waiting on someone). <strong>open</strong> = anything not resolved or closed.
          you can&apos;t close a ticket by hand — mark it <strong>resolved</strong> and it closes
          itself after {AUTO_CLOSE_DAYS} days, leaving time to test the fix.
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="retro-font" style={{ fontSize: 17, color: 'var(--color-muted)' }}>set status →</span>
            {/* No `closed` button — closing is the auto-close sweep's job. */}
            {SETTABLE_STATUSES.map(s => (
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
            const isOpen = expanded === sub.ref
            return (
              <div
                key={sub.ref}
                style={{ borderBottom: '2px solid rgba(44,44,58,0.18)' }}
              >
                {/* Summary row */}
                <div
                  onClick={() => setExpanded(isOpen ? null : sub.ref)}
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
                  <span style={{ padding: '11px 8px', color: 'var(--color-muted)', textAlign: 'center' }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>

                {/* Expanded detail */}
                {isOpen && (
                  <div style={{ borderTop: '3px solid var(--color-dark)', padding: '20px', display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--color-card)' }}>
                    <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
                      <div>
                        <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>REF</div>
                        <div className="retro-font" style={{ fontSize: 18, fontWeight: 'bold' }}>{sub.ref}</div>
                      </div>
                      <div>
                        <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>APP</div>
                        <div className="retro-font" style={{ fontSize: 18 }}>{sub.appId} ({sub.trigram})</div>
                      </div>
                      <div>
                        <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>TYPE</div>
                        <div className="retro-font" style={{ fontSize: 18 }}>{sub.type}</div>
                      </div>
                      <div>
                        <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>LOGGED</div>
                        <div className="retro-font" style={{ fontSize: 18 }}>{new Date(sub.timestamp).toLocaleString('en-GB')}</div>
                      </div>
                    </div>
                    <div>
                      <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>FROM</div>
                      <div className="retro-font" style={{ fontSize: 20 }}>
                        {sub.name}{sub.email ? ` — ${sub.email}` : ' (no email)'}
                      </div>
                    </div>
                    <div>
                      <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 4 }}>MESSAGE</div>
                      <div className="retro-font" style={{ fontSize: 20, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{sub.message}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div>
                        <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 8 }}>STATUS</div>
                        <select
                          className="form-select"
                          value={sub.status}
                          onChange={e => updateStatus(sub.ref, e.target.value as Status)}
                          style={{ width: 'auto' }}
                        >
                          {/* `closed` only ever appears as the (unselectable)
                              current value of an already auto-closed ticket —
                              picking anything else reopens it. */}
                          {sub.status === 'closed' && (
                            <option value="closed" disabled>{STATUS_LABELS.closed}</option>
                          )}
                          {SETTABLE_STATUSES.map(s => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        {autoCloseNote(sub, now) && (
                          <div
                            className="retro-font"
                            style={{ fontSize: 15, color: 'var(--color-muted)', marginTop: 8, maxWidth: 280 }}
                          >
                            {autoCloseNote(sub, now)}
                          </div>
                        )}
                        {sub.status !== 'resolved' && sub.status !== 'closed' && (
                          <div
                            className="retro-font"
                            style={{ fontSize: 15, color: 'var(--color-muted)', marginTop: 8, maxWidth: 280 }}
                          >
                            resolve it to start the {AUTO_CLOSE_DAYS}-day close countdown
                          </div>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div className="retro-font" style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 8 }}>INTERNAL NOTES</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <input
                            className="form-input"
                            value={editNotes[sub.ref] ?? ''}
                            onChange={e => setEditNotes(n => ({ ...n, [sub.ref]: e.target.value }))}
                            placeholder="notes visible only to you..."
                            style={{ flex: 1 }}
                          />
                          <button
                            className="form-submit"
                            onClick={() => saveNotes(sub.ref)}
                            disabled={saving === sub.ref}
                            style={{ padding: '10px 18px', alignSelf: 'stretch' }}
                          >
                            {saving === sub.ref ? '...' : 'SAVE'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
