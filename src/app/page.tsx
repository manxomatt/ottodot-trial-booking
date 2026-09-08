'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { StudentCombobox } from './student-combobox'

interface Student { id: string; name: string; grade: number }
interface Parent { id: string; name: string; email: string; students: Student[] }
interface TrialClass {
  id: string
  subject: string
  title: string
  teacher_name: string
  starts_at: string
  capacity: number
  seats_available: number
  confirmed_count: string
  held_count: string
}

function formatDate(isoString: string) {
  const date = new Date(isoString)
  return date.toLocaleDateString('en-SG', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SeatMatrix({ capacity, confirmed, held }: { capacity: number; confirmed: number; held: number }) {
  const slots = []
  for (let i = 0; i < capacity; i++) {
    if (i < confirmed) {
      slots.push(<div key={i} className="seat-slot confirmed" title="Confirmed seat" />)
    } else if (i < confirmed + held) {
      slots.push(<div key={i} className="seat-slot held" title="Seat held (payment pending)" />)
    } else {
      slots.push(<div key={i} className="seat-slot available" title="Available seat" />)
    }
  }
  return <div className="seat-matrix">{slots}</div>
}

export default function BookingPage() {
  const [parents, setParents] = useState<Parent[]>([])
  const [classes, setClasses] = useState<TrialClass[]>([])
  const [studentId, setStudentId] = useState('')
  const [activeBookings, setActiveBookings] = useState<Record<string, any>>({})
  const [busyClassId, setBusyClassId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadStudentBookings(sid: string) {
    if (!sid) {
      setActiveBookings({})
      return
    }
    try {
      const res = await fetch(`/api/bookings?studentId=${sid}`)
      const data = await res.json()
      const map: Record<string, any> = {}
      for (const b of data.bookings || []) {
        map[b.trial_class_id] = b
      }
      setActiveBookings(map)
    } catch (err) {
      console.error(err)
    }
  }

  async function load() {
    try {
      const [p, c] = await Promise.all([
        fetch('/api/parents').then((r) => r.json()),
        fetch('/api/classes').then((r) => r.json()),
      ])
      setParents(p.parents || [])
      setClasses(c.classes || [])
      const initialSid = studentId || p.parents?.[0]?.students?.[0]?.id
      if (initialSid) {
        if (!studentId) setStudentId(initialSid)
        await loadStudentBookings(initialSid)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (studentId) {
      loadStudentBookings(studentId)
    }
  }, [studentId])

  async function cancelHoldFromList(bookingId: string) {
    if (!confirm('Are you sure you want to cancel this seat hold? The seat will immediately be released for others.')) {
      return
    }
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, { method: 'DELETE' })
      if (res.ok) {
        await Promise.all([load(), loadStudentBookings(studentId)])
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function book(trialClassId: string) {
    setError(null)
    setBusyClassId(trialClassId)
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, trialClassId }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.message ?? data.error)
        await Promise.all([load(), loadStudentBookings(studentId)])
        return
      }
      window.location.href = `/bookings/${data.booking.id}`
    } catch (err: any) {
      setError(err.message || 'Network error occurred')
      await Promise.all([load(), loadStudentBookings(studentId)])
    } finally {
      setBusyClassId(null)
    }
  }

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1>Book a Trial Class</h1>
        <p className="sub">
          Live online math and science classes capped at <strong>4 students</strong>. Choosing a class
          holds a seat for <strong>10 minutes</strong> while payment is completed.
        </p>
      </div>

      <div className="form-card">
        <label className="form-label" style={{ marginBottom: 10 }}>
          Select Student (Simulating Authenticated Parent Session)
        </label>
        <StudentCombobox
          parents={parents}
          selectedStudentId={studentId}
          onSelect={(id) => setStudentId(id)}
          disabled={loading || parents.length === 0}
        />
      </div>

      {error && (
        <div className="alert alert-error">
          <span>⚠️</span>
          <div>
            <strong>Booking failed: </strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      <h2>Available Trial Classes</h2>

      {loading && <p className="meta">Loading trial classes...</p>}

      {!loading && classes.length === 0 && (
        <div className="card">
          <p className="meta">No trial classes found. Make sure the database is seeded.</p>
        </div>
      )}

      {classes.map((trialClass) => {
        const confirmed = Number(trialClass.confirmed_count) || 0
        const held = Number(trialClass.held_count) || 0
        const isFull = trialClass.seats_available < 1
        const isBusy = busyClassId === trialClass.id
        const isMath = trialClass.subject === 'math'

        return (
          <div className="card" key={trialClass.id}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={`badge ${isMath ? 'badge-math' : 'badge-science'}`}>
                    {isMath ? '📐 Math' : '🔬 Science'}
                  </span>
                  <strong>{trialClass.title}</strong>
                </div>

                <div className="meta" style={{ marginBottom: 8 }}>
                  👨‍🏫 {trialClass.teacher_name} &nbsp;·&nbsp; 🗓️ {formatDate(trialClass.starts_at)}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <SeatMatrix
                    capacity={trialClass.capacity}
                    confirmed={confirmed}
                    held={held}
                  />
                  <span className="meta">
                    <strong>{trialClass.seats_available} of {trialClass.capacity}</strong> seats free
                    {confirmed > 0 && ` (${confirmed} confirmed`}
                    {held > 0 && `${confirmed > 0 ? ', ' : ' ('}${held} on hold`}
                    {(confirmed > 0 || held > 0) && ')'}
                  </span>
                </div>
              </div>

              <div>
                {activeBookings[trialClass.id]?.status === 'pending_payment' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Link href={`/bookings/${activeBookings[trialClass.id].id}`}>
                        <button
                          type="button"
                          className="primary"
                          style={{
                            background: 'var(--warning)',
                            borderColor: 'var(--warning)',
                            color: '#92400e',
                            fontWeight: 700,
                          }}
                        >
                          ⏱️ Resume Checkout →
                        </button>
                      </Link>
                      <button
                        type="button"
                        onClick={() => cancelHoldFromList(activeBookings[trialClass.id].id)}
                        style={{
                          background: 'transparent',
                          border: '1px dashed var(--danger)',
                          color: 'var(--danger)',
                          padding: '7px 12px',
                        }}
                        title="Release this seat hold so others can book"
                      >
                        Cancel Hold
                      </button>
                    </div>
                    <span className="meta" style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                      Seat held by this student
                    </span>
                  </div>
                ) : activeBookings[trialClass.id]?.status === 'confirmed' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="pill confirmed">✓ Enrolled</span>
                    <Link href={`/bookings/${activeBookings[trialClass.id].id}`}>
                      <button type="button" style={{ padding: '7px 12px', fontSize: 13 }}>
                        View Booking
                      </button>
                    </Link>
                  </div>
                ) : (
                  <button
                    className={isFull ? 'danger' : 'primary'}
                    disabled={isFull || busyClassId !== null || !studentId}
                    onClick={() => book(trialClass.id)}
                  >
                    {isBusy ? 'Holding Seat...' : isFull ? 'Class Full (4/4)' : 'Hold a Seat →'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
