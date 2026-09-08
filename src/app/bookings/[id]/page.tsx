'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'

const EXPLANATION: Record<string, { desc: string; tip: string }> = {
  pending_payment: {
    desc: 'Seat held temporarily. Complete payment before the timer expires to secure your place on the roster.',
    tip: 'Your seat is reserved in the database while you complete checkout.',
  },
  confirmed: {
    desc: 'Payment successful! The child is officially on the class roster.',
    tip: 'You can check the teacher / admin view to verify the roster entry.',
  },
  payment_failed: {
    desc: 'Payment was declined. The temporary hold was immediately released so someone else can book.',
    tip: 'You can return to the class list to try booking again.',
  },
  expired: {
    desc: 'The seat hold expired before payment was completed. The seat has been put back on sale.',
    tip: 'Please select a trial class again if seats are still available.',
  },
  cancelled_no_seat: {
    desc: 'Payment was received, but the hold had already expired and the last seat was taken by someone else.',
    tip: 'A refund of SGD $50.00 has been queued for operations. The child was not overbooked.',
  },
  cancelled: {
    desc: 'This booking has been cancelled.',
    tip: 'No seat is currently reserved.',
  },
}

function formatDate(isoString: string) {
  return new Date(isoString).toLocaleDateString('en-SG', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function BookingStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [booking, setBooking] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [refundNotice, setRefundNotice] = useState(false)
  const [timeLeft, setTimeLeft] = useState<string | null>(null)
  const [isExpired, setIsExpired] = useState(false)

  async function load() {
    try {
      const data = await fetch(`/api/bookings/${id}`).then((r) => r.json())
      setBooking(data.booking)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  // Countdown timer for seat hold
  useEffect(() => {
    if (!booking?.hold_expires_at || booking.status !== 'pending_payment') {
      setTimeLeft(null)
      return
    }

    function updateTimer() {
      const diff = new Date(booking.hold_expires_at).getTime() - Date.now()
      if (diff <= 0) {
        setTimeLeft('00:00')
        setIsExpired(true)
        return
      }

      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`)
    }

    updateTimer()
    const timer = setInterval(updateTimer, 1000)
    return () => clearInterval(timer)
  }, [booking?.hold_expires_at, booking?.status])

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
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function cancelHold() {
    if (!confirm('Are you sure you want to release this seat? It will be put back on sale immediately.')) {
      return
    }
    setBusy(true)
    try {
      await fetch(`/api/bookings/${id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  if (!booking) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <p className="meta">Loading booking details...</p>
      </div>
    )
  }

  const payable = booking.status === 'pending_payment'
  const isConfirmed = booking.status === 'confirmed'
  const isFailed = booking.status === 'payment_failed' || booking.status === 'cancelled_no_seat' || booking.status === 'expired'
  const explanation = EXPLANATION[booking.status] ?? { desc: booking.status, tip: '' }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span className={`badge ${booking.subject === 'math' ? 'badge-math' : 'badge-science'}`}>
            {booking.subject === 'math' ? '📐 Math' : '🔬 Science'}
          </span>
          <h1>{booking.class_title}</h1>
        </div>
        <p className="sub">
          Student: <strong>{booking.student_name}</strong> &nbsp;·&nbsp; Teacher:{' '}
          <strong>{booking.teacher_name}</strong> &nbsp;·&nbsp; {formatDate(booking.starts_at)}
        </p>
      </div>

      {/* Visual Stepper */}
      <div className="stepper">
        <div className={`step-item ${payable || isConfirmed || isFailed ? 'completed' : ''}`}>
          <div className="step-circle">✓</div>
          <span className="step-label">1. Hold Seat</span>
        </div>
        <div className={`step-item ${payable ? 'active' : isConfirmed ? 'completed' : ''}`}>
          <div className="step-circle">{isConfirmed ? '✓' : '2'}</div>
          <span className="step-label">2. Payment</span>
        </div>
        <div className={`step-item ${isConfirmed ? 'completed active' : ''}`}>
          <div className="step-circle">{isConfirmed ? '✓' : '3'}</div>
          <span className="step-label">3. Roster Confirmed</span>
        </div>
      </div>

      {/* Status Card */}
      <div className="card card-highlight">
        <div className="row" style={{ marginBottom: 12 }}>
          <div>
            <span className={`pill ${booking.status}`}>{booking.status}</span>
          </div>
          <span className="meta">
            Booking ID: <code>{booking.id.slice(0, 8)}…</code>
          </span>
        </div>

        <p style={{ margin: '0 0 8px', fontWeight: 500 }}>{explanation.desc}</p>
        <p className="meta" style={{ margin: 0 }}>💡 {explanation.tip}</p>

        {/* Live Timer Banner if pending */}
        {payable && timeLeft && (
          <div className="timer-banner">
            <div>
              <strong>⏱️ Hold Active:</strong> Seats will release back to the public when this expires.
            </div>
            <div className="timer-countdown">{timeLeft}</div>
          </div>
        )}

        {isExpired && payable && (
          <div className="alert alert-warning" style={{ marginTop: 14 }}>
            <span>⚠️</span>
            <div>The 10-minute hold window has passed. If another user books this slot, your payment will be refunded.</div>
          </div>
        )}
      </div>

      {refundNotice && (
        <div className="alert alert-error">
          <span>⚠️</span>
          <div>
            <strong>Seat No Longer Available:</strong> We captured your payment, but the seat hold expired and another parent confirmed the last seat. A full refund has been recorded and queued for ops.
          </div>
        </div>
      )}

      {/* Mock Payment Action Section */}
      {payable && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ margin: '0 0 8px' }}>Complete Mock Payment</h2>
          <p className="meta" style={{ marginBottom: 18 }}>
            Simulate credit card processing for SGD <strong>$50.00</strong>. Both paths are real transactional backend operations.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="primary"
              disabled={busy}
              onClick={() => pay('success')}
            >
              {busy ? 'Processing...' : '💳 Pay $50.00 (Success)'}
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => pay('failure')}
            >
              {busy ? 'Processing...' : '✕ Simulate Card Decline'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelHold}
              style={{ background: 'transparent', border: '1px dashed var(--danger)', color: 'var(--danger)' }}
            >
              {busy ? 'Releasing...' : '🗑️ Cancel Seat Hold'}
            </button>
          </div>
        </div>
      )}

      {/* Payment History Audit Table */}
      {booking.latest_payment && (
        <div style={{ marginTop: 32 }}>
          <h2>Payment History</h2>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Amount</th>
                <th>Reference</th>
                <th>Outcome / Details</th>
                <th>Refund Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className={`pill ${booking.latest_payment.status === 'succeeded' ? 'confirmed' : 'payment_failed'}`}>
                    {booking.latest_payment.status}
                  </span>
                </td>
                <td>
                  ${(booking.latest_payment.amount_cents / 100).toFixed(2)} {booking.latest_payment.currency}
                </td>
                <td>
                  <code>{booking.latest_payment.provider_ref || 'N/A'}</code>
                </td>
                <td>
                  {booking.latest_payment.failure_reason
                    ? `Declined: ${booking.latest_payment.failure_reason}`
                    : 'Payment captured successfully'}
                </td>
                <td>
                  {booking.latest_payment.refund_required ? (
                    <span className="pill payment_failed">Refund Owed</span>
                  ) : (
                    <span className="meta">None</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 32, display: 'flex', gap: 16 }}>
        <Link href="/">
          <button type="button">← Back to Trial Classes</button>
        </Link>
        <Link href="/admin">
          <button type="button">View Teacher Roster →</button>
        </Link>
      </div>
    </>
  )
}
