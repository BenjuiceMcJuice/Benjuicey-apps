'use client'

import { useState, useEffect, useCallback } from 'react'

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
  notify: boolean
}

const STATUS_COLORS: Record<string, string> = {
  open: '#e74c3c',
  'in-progress': '#f39c12',
  done: '#27ae60',
  'wont-fix': '#95a5a6',
}

const STATUS_OPTIONS = ['open', 'in-progress', 'done', 'wont-fix']

export default function Admin() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterApp, setFilterApp] = useState('all')
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
    const sub = submissions.find(s => s.ref === ref)!
    await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ status, notify: sub.notify ?? false, email: sub.email, name: sub.name }),
    })
    setSubmissions(s => s.map(s2 => s2.ref === ref ? { ...s2, status } : s2))
  }

  async function updateNotify(ref: string, notify: boolean) {
    const pw = sessionStorage.getItem('admin-pw')!
    await fetch(`${API}/admin/submissions/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ notify }),
    })
    setSubmissions(s => s.map(s2 => s2.ref === ref ? { ...s2, notify } : s2))
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

  const filtered = submissions.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (filterApp !== 'all' && s.appId !== filterApp) return false
    return true
  })

  const apps = [...new Set(submissions.map(s => s.appId))]

  const stats = [
    { label: 'total', value: submissions.length, color: 'var(--color-dark)' },
    { label: 'open', value: submissions.filter(s => s.status === 'open').length, color: '#e74c3c' },
    { label: 'in progress', value: submissions.filter(s => s.status === 'in-progress').length, color: '#f39c12' },
    { label: 'done', value: submissions.filter(s => s.status === 'done').length, color: '#27ae60' },
  ]

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
          <h1 className="hero-title pixel-font">admin</h1>
          <p className="hero-sub retro-font">{submissions.length} submissions across {apps.length} apps</p>
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

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {['all', ...STATUS_OPTIONS].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className="retro-font"
            style={{
              padding: '6px 14px', border: '3px solid var(--color-dark)', fontSize: 18, cursor: 'pointer',
              background: filterStatus === s ? 'var(--color-dark)' : 'var(--color-bg)',
              color: filterStatus === s ? 'var(--color-card)' : 'var(--color-dark)',
            }}
          >
            {s}
          </button>
        ))}
        {apps.length > 1 && (
          <select
            className="form-select"
            value={filterApp}
            onChange={e => setFilterApp(e.target.value)}
            style={{ width: 'auto', padding: '6px 14px' }}
          >
            <option value="all">all apps</option>
            {apps.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>

      {loading && <p className="retro-font" style={{ fontSize: 22, color: 'var(--color-muted)' }}>loading...</p>}
      {error && <p className="retro-font" style={{ fontSize: 20, color: 'red' }}>{error}</p>}

      {/* Submissions list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!loading && filtered.length === 0 && (
          <p className="retro-font" style={{ fontSize: 20, color: 'var(--color-muted)' }}>no submissions found</p>
        )}
        {filtered.map(sub => (
          <div key={sub.ref} className="pixel-box" style={{ overflow: 'hidden' }}>
            {/* Summary row */}
            <div
              onClick={() => setExpanded(expanded === sub.ref ? null : sub.ref)}
              style={{
                padding: '14px 20px', cursor: 'pointer',
                background: expanded === sub.ref ? '#ede8dc' : 'transparent',
                display: 'grid',
                gridTemplateColumns: 'auto auto auto 1fr auto auto',
                gap: 16, alignItems: 'center',
              }}
            >
              <span className="pixel-font" style={{ fontSize: 8, whiteSpace: 'nowrap' }}>{sub.ref}</span>
              <span
                className="retro-font"
                style={{ fontSize: 13, color: STATUS_COLORS[sub.status] ?? 'var(--color-muted)', fontWeight: 'bold', whiteSpace: 'nowrap' }}
              >
                {sub.status}
              </span>
              <span className="retro-font" style={{ fontSize: 16, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>{sub.type}</span>
              <span className="retro-font" style={{ fontSize: 19, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{sub.name}</strong> — {sub.message}
              </span>
              <span className="retro-font" style={{ fontSize: 15, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                {new Date(sub.timestamp).toLocaleDateString('en-GB')}
              </span>
              <span style={{ color: 'var(--color-muted)' }}>{expanded === sub.ref ? '▲' : '▼'}</span>
            </div>

            {/* Expanded detail */}
            {expanded === sub.ref && (
              <div style={{ borderTop: '3px solid var(--color-dark)', padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                      onChange={e => updateStatus(sub.ref, e.target.value)}
                      style={{ width: 'auto' }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {sub.email && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={sub.notify ?? false}
                          onChange={e => updateNotify(sub.ref, e.target.checked)}
                        />
                        <span className="retro-font" style={{ fontSize: 16 }}>notify on updates</span>
                      </label>
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
        ))}
      </div>
    </main>
  )
}
