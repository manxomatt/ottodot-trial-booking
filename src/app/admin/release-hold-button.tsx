'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ReleaseHoldButton({
  bookingId,
  studentName,
}: {
  bookingId: string
  studentName: string
}) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function handleRelease() {
    if (!confirm(`Are you sure you want to release the hold for ${studentName}? This seat will immediately become available to other parents.`)) {
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, { method: 'DELETE' })
      if (res.ok) {
        router.refresh()
      } else {
        alert('Failed to release hold.')
      }
    } catch (err) {
      console.error(err)
      alert('Network error releasing hold.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleRelease}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        background: 'transparent',
        border: '1px dashed var(--danger)',
        color: 'var(--danger)',
      }}
      title="Immediately cancel this hold and return the seat to available capacity"
    >
      {busy ? 'Releasing...' : '✕ Cancel Hold'}
    </button>
  )
}
