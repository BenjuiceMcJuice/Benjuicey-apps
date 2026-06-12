'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function Nav() {
  const pathname = usePathname()

  return (
    <nav className="site-nav">
      <Link href="/" className="nav-logo pixel-font">
        benjuicey
      </Link>
      <div className="nav-links">
        <Link
          href="/"
          className={`nav-link retro-font${pathname === '/' ? ' active' : ''}`}
        >
          home
        </Link>
        <Link
          href="/contact"
          className={`nav-link retro-font${pathname === '/contact' ? ' active' : ''}`}
        >
          requests
        </Link>
        <a
          href="https://buymeacoffee.com/benjuicey"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-coffee retro-font"
        >
          ☕ coffee
        </a>
      </div>
    </nav>
  )
}
