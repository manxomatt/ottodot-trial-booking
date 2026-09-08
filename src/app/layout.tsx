import type { Metadata } from 'next'
import { NavHeader } from './nav-header'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ottodot — Trial Booking System',
  description: 'Trial class booking slice with robust concurrency control',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavHeader />
        <main>{children}</main>
      </body>
    </html>
  )
}
