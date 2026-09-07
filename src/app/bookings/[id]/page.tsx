'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'

const EXPLANATION: Record<string, string> = {
  pending_payment: 'Seat held. It goes back on sale if payment is not completed in time.',
  confirmed: 'Paid and on the roster.',
  payment_failed: 'Payment was declined. The seat has been released — you can try again.',
  expired: 'The hold ran out before payment. The seat is back on sale.',
  cancelled_no_seat: 'Payment went through but the seat was already taken. This payment is queued for a refund.',
  cancelled: 'Cancelled.',
}

export default function BookingStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [booking, setBooking] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [refundNotice, setRefundNotice] = useState(false)

  async function load() {
    const data = await fetch(`/api/bookings/${id}`).then((r) => r.json())
    setBooking(data.booking)
  }

  useEffect(() => {
    load()
  }, [id])

  async function pay(outcome: 'success' | 'failure') {
    setBusy(true)
    try {
      const response = await fetch(`/api/bookings/${id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, providerRef: `mock_${Date.now()}` }),
      })
      const result = await response.json()
      setRefundNotice(Boolean(result.refundRequired))
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!booking) return <p>Loading…</p>

  const payable = booking.status === 'pending_payment'

  return (
    <>
      <h1>{booking.class_title}</h1>
      <p className="sub">
        {booking.student_name} · {booking.teacher_name} ·{' '}
        {new Date(booking.starts_at).toLocaleString()}
      </p>

      <div className="card">
        <div className="row">
          <div>
            <span className={`pill ${booking.status}`}>{booking.status}</span>
            <p className="meta" style={{ marginBottom: 0 }}>{EXPLANATION[booking.status]}</p>
          </div>
        </div>
        {booking.hold_expires_at && (
          <p className="meta">Hold expires {new Date(booking.hold_expires_at).toLocaleTimeString()}</p>
        )}
      </div>

      {refundNotice && (
        <p className="error">
          We took your payment but the last seat had already gone. A refund has been queued.
        </p>
      )}

      <h2>Mock payment</h2>
      <p className="meta">
        Stands in for the payment provider. Both outcomes are real code paths, not UI states.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" disabled={!payable || busy} onClick={() => pay('success')}>
          Pay $50 (succeeds)
        </button>
        <button className="danger" disabled={!payable || busy} onClick={() => pay('failure')}>
          Pay $50 (declined)
        </button>
      </div>

      {booking.latest_payment && (
        <>
          <h2>Payment history</h2>
          <table>
            <tbody>
              <tr>
                <th>Last attempt</th>
                <td>
                  {booking.latest_payment.status}
                  {booking.latest_payment.failure_reason && ` — ${booking.latest_payment.failure_reason}`}
                  {booking.latest_payment.refund_required && ' — refund required'}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <p style={{ marginTop: 28 }}>
        <Link href="/">← Back to classes</Link> · <Link href="/admin">Ops view</Link>
      </p>
    </>
  )
}
