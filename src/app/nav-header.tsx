'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavHeader() {
  const pathname = usePathname()

  return (
    <header className="app-header">
      <div className="header-container">
        <Link href="/" className="brand">
          <div className="brand-icon">O</div>
          <div>
            <span className="brand-title">Ottodot</span>
          </div>
          <span className="brand-badge">Trial Booking</span>
        </Link>

        <nav className="nav-tabs">
          <Link
            href="/"
            className={`nav-tab ${pathname === '/' || pathname.startsWith('/bookings') ? 'active' : ''}`}
          >
            👨‍👩‍👧 Parent View
          </Link>
          <Link
            href="/admin"
            className={`nav-tab ${pathname === '/admin' ? 'active' : ''}`}
          >
            👩‍🏫 Teacher / Ops View
          </Link>
        </nav>
      </div>
    </header>
  )
}
