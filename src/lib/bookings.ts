import type { PoolClient } from 'pg'
import { query, withTransaction } from './db'
import { BookingError, UNIQUE_VIOLATION, isPgError } from './errors'

/** How long a parent has to pay before their seat goes back on sale. */
export const HOLD_TTL_MINUTES = Number(process.env.HOLD_TTL_MINUTES ?? 10)
/** Trial class price, in cents. */
export const TRIAL_PRICE_CENTS = 5000

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'payment_failed'
  | 'expired'
  | 'cancelled_no_seat'
  | 'cancelled'

export interface Booking {
  id: string
  student_id: string
  trial_class_id: string
  status: BookingStatus
  hold_expires_at: string | null
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

export interface PaymentAttempt {
  id: string
  booking_id: string
  amount_cents: number
  currency: string
  status: 'succeeded' | 'failed'
  provider_ref: string | null
  failure_reason: string | null
  refund_required: boolean
  created_at: string
}

export interface TrialClassSummary {
  id: string
  subject: string
  title: string
  teacher_name: string
  starts_at: string
  capacity: number
  seats_taken: number
  seats_available: number
  confirmed_count: number
  held_count: number
}

/* -------------------------------------------------------------------------- */
/* Seat accounting                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Releases holds that have run out of time, for one class or (when no class is
 * given) everywhere.
 *
 * This runs in two places: as a background job, and lazily at the top of every
 * booking attempt. The lazy call is what makes the demo work without a worker
 * process running; the job is what keeps seats from sitting dead when nobody is
 * currently trying to book.
 *
 * It is safe to run concurrently. The UPDATE inside the CTE takes a row lock per
 * booking, so a second transaction arriving at the same time waits, re-evaluates
 * `status = 'pending_payment'`, finds the rows already expired, and decrements
 * by zero.
 */
export async function releaseExpiredHolds(client: PoolClient, trialClassId?: string): Promise<number> {
  const result = trialClassId
    ? await client.query(
        `WITH expired AS (
           UPDATE bookings
              SET status = 'expired', hold_expires_at = NULL, updated_at = now()
            WHERE trial_class_id = $1
              AND status = 'pending_payment'
              AND hold_expires_at < now()
            RETURNING id
         )
         UPDATE trial_classes
            SET seats_taken = seats_taken - (SELECT count(*) FROM expired)
          WHERE id = $1
         RETURNING (SELECT count(*) FROM expired) AS released`,
        [trialClassId],
      )
    : await client.query(
        `WITH expired AS (
           UPDATE bookings
              SET status = 'expired', hold_expires_at = NULL, updated_at = now()
            WHERE status = 'pending_payment'
              AND hold_expires_at < now()
            RETURNING id, trial_class_id
         ), per_class AS (
           SELECT trial_class_id, count(*) AS n FROM expired GROUP BY trial_class_id
         )
         UPDATE trial_classes tc
            SET seats_taken = tc.seats_taken - per_class.n
           FROM per_class
          WHERE tc.id = per_class.trial_class_id
         RETURNING per_class.n AS released`,
      )

  return result.rows.reduce((total, row) => total + Number(row.released ?? 0), 0)
}

/**
 * Takes one seat, atomically.
 *
 * This single statement is the whole capacity story. `WHERE seats_taken < capacity`
 * is evaluated while holding the row lock, so two concurrent transactions cannot
 * both see the same free seat: the second one waits for the first to commit,
 * Postgres re-checks the condition against the new value, and it matches zero
 * rows. No SELECT ... FOR UPDATE, no advisory lock, no retry loop.
 *
 * Returns false when the class is full.
 */
async function claimSeat(client: PoolClient, trialClassId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE trial_classes
        SET seats_taken = seats_taken + 1
      WHERE id = $1 AND seats_taken < capacity
      RETURNING id`,
    [trialClassId],
  )
  return result.rowCount === 1
}

async function releaseSeat(client: PoolClient, trialClassId: string): Promise<void> {
  await client.query(
    `UPDATE trial_classes
        SET seats_taken = seats_taken - 1
      WHERE id = $1 AND seats_taken > 0`,
    [trialClassId],
  )
}

async function classExists(client: PoolClient, trialClassId: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM trial_classes WHERE id = $1', [trialClassId])
  return result.rowCount === 1
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listTrialClasses(): Promise<TrialClassSummary[]> {
  await withTransaction((client) => releaseExpiredHolds(client))

  return query<TrialClassSummary>(
    `SELECT tc.id, tc.subject, tc.title, tc.teacher_name, tc.starts_at,
            tc.capacity, tc.seats_taken,
            tc.capacity - tc.seats_taken AS seats_available,
            count(b.id) FILTER (WHERE b.status = 'confirmed')       AS confirmed_count,
            count(b.id) FILTER (WHERE b.status = 'pending_payment') AS held_count
       FROM trial_classes tc
       LEFT JOIN bookings b ON b.trial_class_id = tc.id
      GROUP BY tc.id
      ORDER BY tc.starts_at`,
  )
}

export async function listParentsWithStudents() {
  return query(
    `SELECT p.id, p.name, p.email,
            coalesce(
              json_agg(json_build_object('id', s.id, 'name', s.name, 'grade', s.grade)
                       ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL),
              '[]'
            ) AS students
       FROM parents p
       LEFT JOIN students s ON s.parent_id = p.id
      GROUP BY p.id
      ORDER BY p.name`,
  )
}

export async function getBooking(bookingId: string) {
  const rows = await query(
    `SELECT b.*, s.name AS student_name, tc.title AS class_title, tc.starts_at,
            tc.teacher_name, tc.subject,
            (SELECT row_to_json(pa) FROM payment_attempts pa
              WHERE pa.booking_id = b.id ORDER BY pa.created_at DESC LIMIT 1) AS latest_payment
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN trial_classes tc ON tc.id = b.trial_class_id
      WHERE b.id = $1`,
    [bookingId],
  )
  return rows[0] ?? null
}

/**
 * The roster an ops person or teacher looks at before class.
 *
 * Only `confirmed` bookings are on it. Holds are reported separately so ops can
 * see "3 confirmed, 1 seat being paid for right now" without ever mistaking a
 * hold for an attending child.
 */
export async function getRoster(trialClassId: string) {
  await withTransaction((client) => releaseExpiredHolds(client, trialClassId))

  const classRows = await query<TrialClassSummary>(
    `SELECT id, subject, title, teacher_name, starts_at, capacity, seats_taken,
            capacity - seats_taken AS seats_available
       FROM trial_classes WHERE id = $1`,
    [trialClassId],
  )
  if (classRows.length === 0) throw new BookingError('CLASS_NOT_FOUND')

  const students = await query(
    `SELECT b.id AS booking_id, s.id AS student_id, s.name AS student_name, s.grade,
            p.name AS parent_name, p.email AS parent_email, b.updated_at AS confirmed_at
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN parents p ON p.id = s.parent_id
      WHERE b.trial_class_id = $1 AND b.status = 'confirmed'
      ORDER BY b.updated_at`,
    [trialClassId],
  )

  const holds = await query(
    `SELECT b.id AS booking_id, s.name AS student_name, b.hold_expires_at
       FROM bookings b
       JOIN students s ON s.id = b.student_id
      WHERE b.trial_class_id = $1 AND b.status = 'pending_payment'
      ORDER BY b.created_at`,
    [trialClassId],
  )

  return {
    trial_class: classRows[0],
    confirmed_students: students,
    seats_on_hold: holds,
  }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateBookingInput {
  studentId: string
  trialClassId: string
  idempotencyKey?: string | null
}

/**
 * Step 1 of the flow: hold a seat and open a booking in `pending_payment`.
 *
 * Order matters. We take the seat *before* inserting the booking, so that the
 * capacity check and the row that represents it commit together. If the insert
 * then trips the duplicate index, the whole transaction rolls back and the seat
 * goes straight back on sale.
 */
export async function createBooking({
  studentId,
  trialClassId,
  idempotencyKey = null,
}: CreateBookingInput): Promise<Booking> {
  return withTransaction(async (client) => {
    if (idempotencyKey) {
      const existing = await client.query<Booking>(
        'SELECT * FROM bookings WHERE idempotency_key = $1',
        [idempotencyKey],
      )
      if (existing.rowCount === 1) return existing.rows[0]
    }

    const student = await client.query('SELECT 1 FROM students WHERE id = $1', [studentId])
    if (student.rowCount === 0) throw new BookingError('STUDENT_NOT_FOUND')

    // Try the cheap path first. This is a single conditional UPDATE and takes
    // no lock at all when a seat is free.
    let gotSeat = await claimSeat(client, trialClassId)

    if (!gotSeat) {
      // The class looks full. It may only *look* full because of holds nobody
      // has swept yet, so clean those up and try once more. Deliberately not
      // done up front: that sweep writes to the class row, which would
      // serialise every booking on the busiest table we have.
      const released = await releaseExpiredHolds(client, trialClassId)
      if (released > 0) gotSeat = await claimSeat(client, trialClassId)
    }

    if (!gotSeat) {
      throw (await classExists(client, trialClassId))
        ? new BookingError('CLASS_FULL')
        : new BookingError('CLASS_NOT_FOUND')
    }

    try {
      const inserted = await client.query<Booking>(
        `INSERT INTO bookings (student_id, trial_class_id, status, hold_expires_at, idempotency_key)
         VALUES ($1, $2, 'pending_payment', now() + ($3 || ' minutes')::interval, $4)
         RETURNING *`,
        [studentId, trialClassId, String(HOLD_TTL_MINUTES), idempotencyKey],
      )
      return inserted.rows[0]
    } catch (error) {
      if (isPgError(error, UNIQUE_VIOLATION, 'bookings_one_active_per_student_class')) {
        // Rolling back also gives the seat back — that is the point of taking it
        // inside the transaction.
        throw new BookingError('DUPLICATE_BOOKING')
      }
      throw error
    }
  })
}

export interface SettlePaymentInput {
  bookingId: string
  outcome: 'success' | 'failure'
  providerRef?: string | null
  failureReason?: string | null
  amountCents?: number
}

export interface SettlePaymentResult {
  booking: Booking
  payment: PaymentAttempt
  /** True when we took money we could not seat. Ops has to refund it. */
  refundRequired: boolean
}

/**
 * Step 2: record the payment result and decide what happens to the seat.
 *
 * Money and roster are deliberately separate. A payment attempt is always
 * written down, whatever the outcome; the booking only becomes `confirmed` if a
 * seat is genuinely ours at that moment.
 *
 * The interesting branch is the last one: payment succeeded, but the hold is
 * already gone (someone else took the seat while this parent was on the payment
 * screen). We try once to grab any seat that is still free, and if there is
 * none, the booking ends as `cancelled_no_seat` with the payment flagged for
 * refund. The child is never quietly added to the roster.
 */
export async function settlePayment({
  bookingId,
  outcome,
  providerRef = null,
  failureReason = null,
  amountCents = TRIAL_PRICE_CENTS,
}: SettlePaymentInput): Promise<SettlePaymentResult> {
  return withTransaction(async (client) => {
    const bookingRows = await client.query<Booking>(
      'SELECT * FROM bookings WHERE id = $1 FOR UPDATE',
      [bookingId],
    )
    if (bookingRows.rowCount === 0) throw new BookingError('BOOKING_NOT_FOUND')
    const booking = bookingRows.rows[0]

    // Webhook replay: the provider already told us about this payment.
    if (providerRef) {
      const seen = await client.query<PaymentAttempt>(
        'SELECT * FROM payment_attempts WHERE provider_ref = $1',
        [providerRef],
      )
      if (seen.rowCount === 1) {
        const current = await client.query<Booking>('SELECT * FROM bookings WHERE id = $1', [bookingId])
        return {
          booking: current.rows[0],
          payment: seen.rows[0],
          refundRequired: seen.rows[0].refund_required,
        }
      }
    }

    /* ---- payment declined ------------------------------------------------ */
    if (outcome === 'failure') {
      if (booking.status === 'pending_payment') {
        await releaseSeat(client, booking.trial_class_id)
        await client.query(
          `UPDATE bookings SET status = 'payment_failed', hold_expires_at = NULL, updated_at = now()
            WHERE id = $1`,
          [bookingId],
        )
      }
      const payment = await insertPayment(client, {
        bookingId,
        amountCents,
        status: 'failed',
        providerRef,
        failureReason: failureReason ?? 'card_declined',
        refundRequired: false,
      })
      const updated = await client.query<Booking>('SELECT * FROM bookings WHERE id = $1', [bookingId])
      return { booking: updated.rows[0], payment, refundRequired: false }
    }

    /* ---- payment succeeded ----------------------------------------------- */

    // Already confirmed: nothing to do, and no second seat taken.
    if (booking.status === 'confirmed') {
      const payment = await insertPayment(client, {
        bookingId,
        amountCents,
        status: 'succeeded',
        providerRef,
        failureReason: null,
        refundRequired: false,
      })
      return { booking, payment, refundRequired: false }
    }

    // The normal path: the hold is still ours, so the seat is already counted.
    if (booking.status === 'pending_payment') {
      const confirmed = await client.query<Booking>(
        `UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [bookingId],
      )
      const payment = await insertPayment(client, {
        bookingId,
        amountCents,
        status: 'succeeded',
        providerRef,
        failureReason: null,
        refundRequired: false,
      })
      return { booking: confirmed.rows[0], payment, refundRequired: false }
    }

    // The hold is gone (expired, or the parent's earlier attempt failed) but the
    // money went through anyway. Try once to seat them; otherwise refund.
    const gotSeat = await claimSeat(client, booking.trial_class_id)
    if (gotSeat) {
      try {
        const confirmed = await client.query<Booking>(
          `UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL, updated_at = now()
            WHERE id = $1 RETURNING *`,
          [bookingId],
        )
        const payment = await insertPayment(client, {
          bookingId,
          amountCents,
          status: 'succeeded',
          providerRef,
          failureReason: null,
          refundRequired: false,
        })
        return { booking: confirmed.rows[0], payment, refundRequired: false }
      } catch (error) {
        if (!isPgError(error, UNIQUE_VIOLATION, 'bookings_one_active_per_student_class')) throw error
        // The child got a seat in this class through another booking in the
        // meantime. Give the seat back and refund this payment.
        await releaseSeat(client, booking.trial_class_id)
      }
    }

    const cancelled = await client.query<Booking>(
      `UPDATE bookings SET status = 'cancelled_no_seat', hold_expires_at = NULL, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [bookingId],
    )
    const payment = await insertPayment(client, {
      bookingId,
      amountCents,
      status: 'succeeded',
      providerRef,
      failureReason: null,
      refundRequired: true,
    })
    return { booking: cancelled.rows[0], payment, refundRequired: true }
  })
}

async function insertPayment(
  client: PoolClient,
  input: {
    bookingId: string
    amountCents: number
    status: 'succeeded' | 'failed'
    providerRef: string | null
    failureReason: string | null
    refundRequired: boolean
  },
): Promise<PaymentAttempt> {
  const result = await client.query<PaymentAttempt>(
    `INSERT INTO payment_attempts
       (booking_id, amount_cents, status, provider_ref, failure_reason, refund_required)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.bookingId,
      input.amountCents,
      input.status,
      input.providerRef,
      input.failureReason,
      input.refundRequired,
    ],
  )
  return result.rows[0]
}

/** Background-job entry point. Returns how many seats went back on sale. */
export async function expireHolds(): Promise<number> {
  return withTransaction((client) => releaseExpiredHolds(client))
}

/**
 * Cancels an active booking (by parent or ops) and releases the seat immediately
 * if it was currently holding one.
 */
export async function cancelBooking(bookingId: string): Promise<Booking> {
  return withTransaction(async (client) => {
    const bookingRows = await client.query<Booking>(
      'SELECT * FROM bookings WHERE id = $1 FOR UPDATE',
      [bookingId],
    )
    if (bookingRows.rowCount === 0) throw new BookingError('BOOKING_NOT_FOUND')
    const booking = bookingRows.rows[0]

    // If it holds a seat (pending_payment), return it to the class right now
    if (booking.status === 'pending_payment') {
      await releaseSeat(client, booking.trial_class_id)
    }

    const updated = await client.query<Booking>(
      `UPDATE bookings
          SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [bookingId],
    )

    return updated.rows[0]
  })
}

/** Returns all active bookings (pending_payment or confirmed) for a given student. */
export async function listActiveBookingsForStudent(studentId: string): Promise<Booking[]> {
  return query<Booking>(
    `SELECT * FROM bookings
      WHERE student_id = $1 AND status IN ('pending_payment', 'confirmed')
      ORDER BY created_at DESC`,
    [studentId],
  )
}

/** Test/demo helper: force a booking's hold to look expired. */
export async function forceExpireHold(bookingId: string): Promise<void> {
  await query(
    `UPDATE bookings SET hold_expires_at = now() - interval '1 second'
      WHERE id = $1 AND status = 'pending_payment'`,
    [bookingId],
  )
}
