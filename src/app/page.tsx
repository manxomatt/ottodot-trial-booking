'use client'

import { useEffect, useState } from 'react'
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
  const [busyClassId, setBusyClassId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const [p, c] = await Promise.all([
        fetch('/api/parents').then((r) => r.json()),
        fetch('/api/classes').then((r) => r.json()),
      ])
      setParents(p.parents || [])
      setClasses(c.classes || [])
      if (!studentId && p.parents?.[0]?.students?.[0]) {
        setStudentId(p.parents[0].students[0].id)
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
        await load()
        return
      }
      window.location.href = `/bookings/${data.booking.id}`
    } catch (err: any) {
      setError(err.message || 'Network error occurred')
      await load()
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
                <button
                  className={isFull ? 'danger' : 'primary'}
                  disabled={isFull || busyClassId !== null || !studentId}
                  onClick={() => book(trialClass.id)}
                >
                  {isBusy ? 'Holding Seat...' : isFull ? 'Class Full (4/4)' : 'Hold a Seat →'}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
