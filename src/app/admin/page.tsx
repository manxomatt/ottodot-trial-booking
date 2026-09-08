import Link from 'next/link'
import { getRoster, listTrialClasses } from '@/lib/bookings'

export const dynamic = 'force-dynamic'

function formatDate(isoString: string) {
  return new Date(isoString).toLocaleDateString('en-SG', {
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
      slots.push(<div key={i} className="seat-slot confirmed" title="Confirmed student" />)
    } else if (i < confirmed + held) {
      slots.push(<div key={i} className="seat-slot held" title="Seat held (payment pending)" />)
    } else {
      slots.push(<div key={i} className="seat-slot available" title="Available seat" />)
    }
  }
  return <div className="seat-matrix">{slots}</div>
}

export default async function AdminPage() {
  const classes = await listTrialClasses()
  const rosters = await Promise.all(classes.map((trialClass) => getRoster(trialClass.id)))

  const totalConfirmed = rosters.reduce((acc, r) => acc + r.confirmed_students.length, 0)

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1>Trial Class Rosters (Operations & Teachers)</h1>
            <p className="sub" style={{ marginBottom: 0 }}>
              Live, real-time roster for teaching staff. Only <strong>confirmed (paid)</strong> students
              appear on the attendance list.
            </p>
          </div>
          <div className="pill confirmed" style={{ fontSize: 13, padding: '6px 14px' }}>
            ✓ {totalConfirmed} Total Students Confirmed
          </div>
        </div>
      </div>

      {rosters.map(({ trial_class, confirmed_students, seats_on_hold }) => {
        const isMath = trial_class.subject === 'math'
        const confirmed = confirmed_students.length
        const held = seats_on_hold.length

        return (
          <div className="card" key={trial_class.id} style={{ marginBottom: 20 }}>
            <div className="row" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className={`badge ${isMath ? 'badge-math' : 'badge-science'}`}>
                    {isMath ? '📐 Math' : '🔬 Science'}
                  </span>
                  <strong style={{ fontSize: 16 }}>{trial_class.title}</strong>
                </div>
                <div className="meta">
                  👨‍🏫 {trial_class.teacher_name} &nbsp;·&nbsp; 🗓️ {formatDate(trial_class.starts_at)}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <SeatMatrix
                  capacity={trial_class.capacity}
                  confirmed={confirmed}
                  held={held}
                />
                <span
                  className={`pill ${confirmed === trial_class.capacity ? 'confirmed' : 'pending_payment'}`}
                  style={{ fontSize: 12 }}
                >
                  {confirmed} / {trial_class.capacity} Confirmed
                </span>
              </div>
            </div>

            {confirmed_students.length > 0 ? (
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Grade</th>
                    <th>Parent / Guardian</th>
                    <th>Contact Email</th>
                    <th>Confirmed At</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmed_students.map((student: any) => (
                    <tr key={student.booking_id}>
                      <td>
                        <strong>{student.student_name}</strong>
                      </td>
                      <td>
                        <span className="badge" style={{ background: 'var(--bg)' }}>
                          P{student.grade}
                        </span>
                      </td>
                      <td>{student.parent_name}</td>
                      <td className="meta">{student.parent_email}</td>
                      <td className="meta">
                        {new Date(student.confirmed_at).toLocaleTimeString('en-SG', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="meta" style={{ margin: '14px 0 8px', fontStyle: 'italic' }}>
                No students confirmed yet for this trial class.
              </p>
            )}

            {seats_on_hold.length > 0 && (
              <div className="alert alert-warning" style={{ marginTop: 14, marginBottom: 4 }}>
                <span>⏱️</span>
                <div>
                  <strong>{seats_on_hold.length} seat(s) currently on hold:</strong>{' '}
                  {seats_on_hold.map((h: any) => h.student_name).join(', ')} is in checkout. Held seats
                  are strictly segregated and never listed as attending students.
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <span className="meta">
                API Endpoint: <code>GET /api/classes/{trial_class.id}/roster</code>
              </span>
            </div>
          </div>
        )
      })}
    </>
  )
}
