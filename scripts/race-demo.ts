/**
 * Runs the three race scenarios end to end against the real database and prints
 * what happened. This is the script used in the video walkthrough.
 *
 *   npm run race-demo
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import './load-env'
import { createBooking, getRoster, settlePayment, forceExpireHold } from '../src/lib/bookings'
import { closePool, getPool, query } from '../src/lib/db'
import { BookingError } from '../src/lib/errors'

const CLASS_WITH_ONE_SEAT = 'c0000000-0000-0000-0000-000000000002' // 3 of 4 confirmed
const STUDENT_A = 'a1111111-0000-0000-0000-000000000001' // Chloe  (parent: Mei Ling)
const STUDENT_B = 'a4444444-0000-0000-0000-000000000002' // Olivia (parent: Daniel)
const STUDENT_C = 'a1111111-0000-0000-0000-000000000002' // Ethan

async function reset() {
  const pool = getPool()
  await pool.query(readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8'))
  await pool.query(readFileSync(join(process.cwd(), 'db', 'seed.sql'), 'utf8'))
}

function line(label: string, value: unknown) {
  console.log(`   ${label.padEnd(34)} ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

async function seatsLeft(classId: string) {
  const rows = await query<{ left: number }>(
    'SELECT capacity - seats_taken AS left FROM trial_classes WHERE id = $1',
    [classId],
  )
  return Number(rows[0].left)
}

/* Scenario 1 — B arrives while A is on the payment screen. */
async function scenarioHoldBlocksSecondParent() {
  console.log('\n=== 1. A holds the last seat, B arrives before A has paid ===')
  await reset()
  line('seats left at start', await seatsLeft(CLASS_WITH_ONE_SEAT))

  const a = await createBooking({ studentId: STUDENT_A, trialClassId: CLASS_WITH_ONE_SEAT })
  line('A booking status', a.status)
  line('seats left after A holds', await seatsLeft(CLASS_WITH_ONE_SEAT))

  try {
    await createBooking({ studentId: STUDENT_B, trialClassId: CLASS_WITH_ONE_SEAT })
    line('B booking', 'UNEXPECTED SUCCESS — invariant broken')
  } catch (error) {
    line('B booking rejected with', (error as BookingError).code)
  }

  const settled = await settlePayment({ bookingId: a.id, outcome: 'success', providerRef: 'demo_1_a' })
  line('A after payment', settled.booking.status)

  const roster = await getRoster(CLASS_WITH_ONE_SEAT)
  line('confirmed on roster', roster.confirmed_students.length)
}

/* Scenario 2 — exactly the sequence in the brief. */
async function scenarioLatePaymentAfterHoldExpired() {
  console.log('\n=== 2. A dawdles, hold expires, B pays first, A pays late ===')
  await reset()

  const a = await createBooking({ studentId: STUDENT_A, trialClassId: CLASS_WITH_ONE_SEAT })
  line('A holds last seat', a.status)

  await forceExpireHold(a.id)
  line('A hold forced to expire', 'yes')

  const b = await createBooking({ studentId: STUDENT_B, trialClassId: CLASS_WITH_ONE_SEAT })
  line('B picks up the freed seat', b.status)

  const bPaid = await settlePayment({ bookingId: b.id, outcome: 'success', providerRef: 'demo_2_b' })
  line('B after payment', bPaid.booking.status)

  const aPaid = await settlePayment({ bookingId: a.id, outcome: 'success', providerRef: 'demo_2_a' })
  line('A after paying late', aPaid.booking.status)
  line('A payment flagged for refund', aPaid.refundRequired)

  const roster = await getRoster(CLASS_WITH_ONE_SEAT)
  line('confirmed on roster', roster.confirmed_students.length)
  line('names on roster', roster.confirmed_students.map((s: any) => s.student_name).join(', '))
}

/* Scenario 3 — genuine concurrency, not a simulated sequence. */
async function scenarioSimultaneousRush() {
  console.log('\n=== 3. Eight parents hit the last seat at the same moment ===')
  await reset()

  const students = [STUDENT_A, STUDENT_B, STUDENT_C]
  const attempts = Array.from({ length: 8 }, (_, i) =>
    createBooking({ studentId: students[i % students.length], trialClassId: CLASS_WITH_ONE_SEAT })
      .then(() => 'booked' as const)
      .catch((error: BookingError) => error.code),
  )

  const results = await Promise.all(attempts)
  const booked = results.filter((r) => r === 'booked').length

  line('attempts', results.length)
  line('successful bookings', booked)
  line('rejections', results.filter((r) => r !== 'booked').join(', '))
  line('seats left', await seatsLeft(CLASS_WITH_ONE_SEAT))
  line('invariant holds', booked === 1 ? 'yes — exactly one seat sold' : 'NO — OVERSOLD')
}

async function main() {
  await scenarioHoldBlocksSecondParent()
  await scenarioLatePaymentAfterHoldExpired()
  await scenarioSimultaneousRush()
  console.log('\nDone. Database left in the state of scenario 3; run `npm run db:reset` to restore the seed.\n')
  await closePool()
}

main().catch(async (error) => {
  console.error(error)
  await closePool()
  process.exit(1)
})
