import type { Metadata, Viewport } from 'next'
import { Press_Start_2P, VT323 } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/Nav'

const pressStart2P = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
})

const vt323 = VT323({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-retro',
  display: 'swap',
})

export const metadata: Metadata = {
  title: "Benjuicey's Apps",
  description: 'A collection of apps, tools, and experiments made by Benjuicey.',
}

// viewportFit: 'cover' lets the layout reach under the notch/home indicator —
// the safe-area padding in globals.css keeps content clear of both.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4ede0',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pressStart2P.variable} ${vt323.variable}`}>
      <body>
        <Nav />
        {children}
        <footer className="site-footer">
          <p className="footer-text retro-font">made with ♥ and too much coffee</p>
        </footer>
      </body>
    </html>
  )
}
