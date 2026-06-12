'use client'

import Link from 'next/link'
import type { App, AppStatus } from '@/data/categories'

const STATUS_LABEL: Record<AppStatus, string> = {
  live: '● live',
  wip: '◌ wip',
  broken: '✕ broken',
}

const STATUS_COLOR: Record<AppStatus, string> = {
  live: '#7db87d',
  wip: '#c8a84a',
  broken: '#e87474',
}

type Props = {
  app: App
  accentColor: string
}

export function AppCard({ app, accentColor }: Props) {
  const isReal = app.url !== '#'

  return (
    <div className="app-card">
      <div className="card-strip" style={{ backgroundColor: accentColor }} />
      <div className="card-body">
        <div className="card-top-row">
          <h3 className="card-name pixel-font">{app.name}</h3>
          {app.status && (
            <span
              className="card-status retro-font"
              style={{ color: STATUS_COLOR[app.status] }}
            >
              {STATUS_LABEL[app.status]}
            </span>
          )}
        </div>
        <p className="card-desc retro-font">{app.description}</p>
        <Link
          href={app.url}
          className="card-btn"
          target={isReal ? '_blank' : undefined}
          rel={isReal ? 'noopener noreferrer' : undefined}
          aria-disabled={!isReal}
          onClick={isReal ? undefined : (e) => e.preventDefault()}
        >
          <span className="card-btn-text pixel-font">VISIT →</span>
        </Link>
      </div>
    </div>
  )
}
