'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

const API = process.env.NEXT_PUBLIC_FEEDBACK_API_URL!

interface Submission {
  ref: string
  appId: string
  trigram: string
  type: string
  status: string
  name: string
  email: string
  contactConsent?: boolean
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

const GRID_TEMPLATE = COLUMNS.map(c => c.track).join(' ') + ' 34px'
const GRID_MIN_WIDTH = 940

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

export default function Admin() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Default view: OPEN tickets only.
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, status: 'open' })
  const [sortKey, setSortKey] = useState<ColKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

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

  async function updateStatus(ref: string, status: string) {
    const pw = sessionStorage.getItem('admin-pw')!
    await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ status }),
    })
    setSubmissions(s => s.map(sub => sub.ref === ref ? { ...sub, status } : sub))
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
      COLUMNS.every(c => {
        const raw = c.key === 'timestamp'
          ? new Date(s.timestamp).toLocaleDateString('en-GB')
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
  }, [submissions, filters, sortKey, sortDir])

  const stats = [
    { label: 'total', value: submissions.length, color: 'var(--color-dark)' },
    { label: 'open', value: submissions.filter(s => s.status === 'open').length, color: '#e74c3c' },
    { label: 'in progress', value: submissions.filter(s => s.status === 'in-progress').length, color: '#f39c12' },
    { label: 'done', value: submissions.filter(s => s.status === 'done').length, color: '#27ae60' },
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
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        <div className="hero pixel-box" style={{ flex: 1 }}>
          <h1 className="hero-title pixel-font">fault console</h1>
          <p className="hero-sub retro-font">{submissions.length} tickets across {appCount} apps</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {stats.map(s => (
          <div key={s.label} className="pixel-box" style={{ padding: '16px 20px', textAlign: 'center' }}>
            <div className="pixel-font" style={{ fontSize: 22, color: s.color, marginBottom: 8 }}>{s.value}</div>
            <div className="retro-font" style={{ fontSize: 18, color: 'var(--color-muted)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar: status presets + filter meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {[{ v: '', label: 'all' }, ...STATUS_OPTIONS.map(s => ({ v: s, label: s }))].map(s => (
              <button
                key={s.label}
                onClick={() => setFilter('status', s.v)}
                className="retro-font"
                style={{
                  padding: '6px 14px', border: '3px solid var(--color-dark)', fontSize: 18, cursor: 'pointer',
                  background: filters.status === s.v ? 'var(--color-dark)' : 'var(--color-bg)',
                  color: filters.status === s.v ? 'var(--color-card)' : 'var(--color-dark)',
                }}
              >
                {s.label}
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
      </div>

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
              no tickets match the current filters
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
                  <span className="retro-font" style={{ padding: '11px 12px', fontSize: 16, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                    {sub.ref}
                  </span>
                  <span style={{ padding: '11px 12px', whiteSpace: 'nowrap' }}>
                    <span
                      className="retro-font"
                      style={{
                        fontSize: 14, fontWeight: 'bold',
                        color: STATUS_COLORS[sub.status] ?? 'var(--color-muted)',
                        borderBottom: `2px solid ${STATUS_COLORS[sub.status] ?? 'var(--color-muted)'}`,
                        paddingBottom: 1,
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
                      {sub.email && (
                        <div className="retro-font" style={{ fontSize: 14, marginTop: 4, color: sub.contactConsent ? '#27ae60' : '#e67e22' }}>
                          {sub.contactConsent ? '✓ OK to contact' : '✕ did NOT consent to contact — do not reply'}
                        </div>
                      )}
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
                          onChange={e => updateStatus(sub.ref, e.target.value)}
                          style={{ width: 'auto' }}
                        >
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
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
