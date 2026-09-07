'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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

export default function BookingPage() {
  const [parents, setParents] = useState<Parent[]>([])
  const [classes, setClasses] = useState<TrialClass[]>([])
  const [studentId, setStudentId] = useState('')
  const [busyClassId, setBusyClassId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [p, c] = await Promise.all([
      fetch('/api/parents').then((r) => r.json()),
      fetch('/api/classes').then((r) => r.json()),
    ])
    setParents(p.parents)
    setClasses(c.classes)
    if (!studentId && p.parents[0]?.students[0]) setStudentId(p.parents[0].students[0].id)
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
    } finally {
      setBusyClassId(null)
    }
  }

  return (
    <>
      <h1>Book a trial class</h1>
      <p className="sub">
        Trials are capped at 4 children. Picking a class holds a seat for 10 minutes while you pay.{' '}
        <Link href="/admin">Ops view</Link>
      </p>

      <label>
        Child:{' '}
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {parents.map((parent) => (
            <optgroup key={parent.id} label={parent.name}>
              {parent.students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} (P{student.grade})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {error && <p className="error">{error}</p>}

      <h2>Available trials</h2>
      {classes.map((trialClass) => (
        <div className="card" key={trialClass.id}>
          <div className="row">
            <div>
              <strong>{trialClass.title}</strong>
              <div className="meta">
                {trialClass.teacher_name} · {new Date(trialClass.starts_at).toLocaleString()}
              </div>
              <div className="meta">
                {trialClass.confirmed_count} confirmed
                {Number(trialClass.held_count) > 0 && ` · ${trialClass.held_count} being paid for`} ·{' '}
                {trialClass.seats_available} of {trialClass.capacity} seats free
              </div>
            </div>
            <button
              className="primary"
              disabled={trialClass.seats_available < 1 || busyClassId !== null || !studentId}
              onClick={() => book(trialClass.id)}
            >
              {trialClass.seats_available < 1 ? 'Full' : 'Hold a seat'}
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
