import Link from 'next/link'
import { getRoster, listTrialClasses } from '@/lib/bookings'

export const dynamic = 'force-dynamic'

/**
 * The ops / teacher view: every trial class with its confirmed roster.
 *
 * Holds are shown separately and never counted as attendees — a child who is
 * halfway through paying is not someone a teacher should be expecting.
 */
export default async function AdminPage() {
  const classes = await listTrialClasses()
  const rosters = await Promise.all(classes.map((trialClass) => getRoster(trialClass.id)))

  return (
    <>
      <h1>Trial class rosters</h1>
      <p className="sub">
        Confirmed seats only. <Link href="/">Parent view</Link>
      </p>

      {rosters.map(({ trial_class, confirmed_students, seats_on_hold }) => (
        <div className="card" key={trial_class.id}>
          <div className="row">
            <div>
              <strong>{trial_class.title}</strong>
              <div className="meta">
                {trial_class.teacher_name} · {new Date(trial_class.starts_at).toLocaleString()}
              </div>
            </div>
            <div className="meta">
              {confirmed_students.length} / {trial_class.capacity} confirmed
            </div>
          </div>

          {confirmed_students.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Child</th>
                  <th>Grade</th>
                  <th>Parent</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {confirmed_students.map((student: any) => (
                  <tr key={student.booking_id}>
                    <td>{student.student_name}</td>
                    <td>P{student.grade}</td>
                    <td>{student.parent_name}</td>
                    <td className="meta">{student.parent_email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {seats_on_hold.length > 0 && (
            <p className="meta" style={{ marginTop: 10 }}>
              {seats_on_hold.length} seat(s) on hold, waiting for payment — not on the roster.
            </p>
          )}

          <p className="meta" style={{ marginTop: 10 }}>
            API: <code>GET /api/classes/{trial_class.id}/roster</code>
          </p>
        </div>
      ))}
    </>
  )
}
