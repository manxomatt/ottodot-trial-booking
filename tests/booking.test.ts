import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  cancelBooking,
  createBooking,
  expireHolds,
  forceExpireHold,
  getRoster,
  settlePayment,
} from '../src/lib/bookings'
import { closePool, query } from '../src/lib/db'
import { BookingError } from '../src/lib/errors'
import { IDS, confirmedCount, resetDatabase, seatsTaken } from './helpers'

beforeEach(resetDatabase)
afterAll(closePool)

/**
 * Turns a rejection into something assertable. Anything that is not a
 * BookingError is reported as `unexpected:<message>` rather than being
 * swallowed, so a raw database error can never quietly look like a clean
 * "class is full" rejection.
 */
function asErrorCode(error: unknown): string {
  if (error instanceof BookingError) return error.code
  return `unexpected:${(error as Error).message}`
}

describe('happy path', () => {
  it('holds a seat, confirms on payment, and puts the child on the roster', async () => {
    const booking = await createBooking({
      studentId: IDS.olivia,
      trialClassId: IDS.classWithSeats,
    })
    expect(booking.status).toBe('pending_payment')
    expect(booking.hold_expires_at).not.toBeNull()
    expect(await seatsTaken(IDS.classWithSeats)).toBe(2)

    const result = await settlePayment({ bookingId: booking.id, outcome: 'success' })
    expect(result.booking.status).toBe('confirmed')
    expect(result.refundRequired).toBe(false)

    // Confirming must not take a second seat.
    expect(await seatsTaken(IDS.classWithSeats)).toBe(2)

    const roster = await getRoster(IDS.classWithSeats)
    expect(roster.confirmed_students.map((s: any) => s.student_name)).toContain('Olivia Wong')
    expect(roster.seats_on_hold).toHaveLength(0)
  })
})

describe('duplicate bookings', () => {
  it('rejects a second booking for a child who is already confirmed in that class', async () => {
    await expect(
      createBooking({ studentId: IDS.chloe, trialClassId: IDS.classWithSeats }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING' })
  })

  it('rejects a second booking while the first is still pending payment', async () => {
    await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classWithSeats })
    await expect(
      createBooking({ studentId: IDS.olivia, trialClassId: IDS.classWithSeats }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING' })
  })

  it('does not leak a seat when a duplicate is rejected', async () => {
    const before = await seatsTaken(IDS.classWithSeats)
    await expect(
      createBooking({ studentId: IDS.chloe, trialClassId: IDS.classWithSeats }),
    ).rejects.toBeInstanceOf(BookingError)
    expect(await seatsTaken(IDS.classWithSeats)).toBe(before)
  })

  it('allows a retry after a failed payment, because a dead booking blocks nothing', async () => {
    const retry = await createBooking({
      studentId: IDS.olivia,
      trialClassId: IDS.classWithFailedPayment,
    })
    expect(retry.status).toBe('pending_payment')
  })

  it('returns the same booking for a repeated idempotency key instead of a second one', async () => {
    const first = await createBooking({
      studentId: IDS.olivia,
      trialClassId: IDS.classWithSeats,
      idempotencyKey: 'checkout-abc',
    })
    const second = await createBooking({
      studentId: IDS.olivia,
      trialClassId: IDS.classWithSeats,
      idempotencyKey: 'checkout-abc',
    })
    expect(second.id).toBe(first.id)
    expect(await seatsTaken(IDS.classWithSeats)).toBe(2)
  })
})

describe('capacity', () => {
  it('refuses a booking on a class that is already full', async () => {
    await expect(
      createBooking({ studentId: IDS.chloe, trialClassId: IDS.classFull }),
    ).rejects.toMatchObject({ code: 'CLASS_FULL' })
  })

  it('never lets confirmed bookings exceed four', async () => {
    const booking = await createBooking({
      studentId: IDS.chloe,
      trialClassId: IDS.classOneSeatLeft,
    })
    await settlePayment({ bookingId: booking.id, outcome: 'success' })

    expect(await confirmedCount(IDS.classOneSeatLeft)).toBe(4)
    await expect(
      createBooking({ studentId: IDS.ethan, trialClassId: IDS.classOneSeatLeft }),
    ).rejects.toMatchObject({ code: 'CLASS_FULL' })
  })

  it('is enforced by the database, not only by the service layer', async () => {
    // Bypass every application check and try to oversell directly.
    await expect(
      query('UPDATE trial_classes SET seats_taken = 5 WHERE id = $1', [IDS.classOneSeatLeft]),
    ).rejects.toMatchObject({ constraint: 'trial_classes_seats_within_capacity' })
  })
})

describe('payment failure', () => {
  it('keeps the child off the roster and puts the seat back', async () => {
    const booking = await createBooking({
      studentId: IDS.olivia,
      trialClassId: IDS.classOneSeatLeft,
    })
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(4)

    const result = await settlePayment({
      bookingId: booking.id,
      outcome: 'failure',
      failureReason: 'insufficient_funds',
    })

    expect(result.booking.status).toBe('payment_failed')
    expect(await confirmedCount(IDS.classOneSeatLeft)).toBe(3)
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(3)

    const roster = await getRoster(IDS.classOneSeatLeft)
    expect(roster.confirmed_students.map((s: any) => s.student_name)).not.toContain('Olivia Wong')
  })

  it('records the failed attempt so support can see what happened', async () => {
    const booking = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classWithSeats })
    await settlePayment({ bookingId: booking.id, outcome: 'failure', failureReason: 'card_declined' })

    const attempts = await query<{ status: string; failure_reason: string }>(
      'SELECT status, failure_reason FROM payment_attempts WHERE booking_id = $1',
      [booking.id],
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('failed')
    expect(attempts[0].failure_reason).toBe('card_declined')
  })

  it('frees the seat for someone else immediately', async () => {
    const first = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classOneSeatLeft })
    await settlePayment({ bookingId: first.id, outcome: 'failure' })

    const second = await createBooking({ studentId: IDS.chloe, trialClassId: IDS.classOneSeatLeft })
    expect(second.status).toBe('pending_payment')
  })
})

describe('the last-seat race', () => {
  it('blocks the second parent while the first still holds the seat', async () => {
    const a = await createBooking({ studentId: IDS.chloe, trialClassId: IDS.classOneSeatLeft })
    expect(a.status).toBe('pending_payment')

    await expect(
      createBooking({ studentId: IDS.olivia, trialClassId: IDS.classOneSeatLeft }),
    ).rejects.toMatchObject({ code: 'CLASS_FULL' })
  })

  it('gives the seat to whoever pays first, and refunds the loser rather than overbooking', async () => {
    // A takes the last seat but wanders off.
    const a = await createBooking({ studentId: IDS.chloe, trialClassId: IDS.classOneSeatLeft })
    await forceExpireHold(a.id)

    // B books the seat that A let go, and pays.
    const b = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classOneSeatLeft })
    const bResult = await settlePayment({ bookingId: b.id, outcome: 'success' })
    expect(bResult.booking.status).toBe('confirmed')

    // A now completes payment. The money lands, the seat does not.
    const aResult = await settlePayment({ bookingId: a.id, outcome: 'success' })
    expect(aResult.booking.status).toBe('cancelled_no_seat')
    expect(aResult.refundRequired).toBe(true)

    expect(await confirmedCount(IDS.classOneSeatLeft)).toBe(4)
    const roster = await getRoster(IDS.classOneSeatLeft)
    const names = roster.confirmed_students.map((s: any) => s.student_name)
    expect(names).toContain('Olivia Wong')
    expect(names).not.toContain('Chloe Tan')
  })

  it('sells exactly one seat when many parents click at the same instant', async () => {
    const students = [IDS.chloe, IDS.olivia, IDS.ethan]

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        createBooking({ studentId: students[i % students.length], trialClassId: IDS.classOneSeatLeft })
          .then(() => 'booked' as const)
          .catch(asErrorCode),
      ),
    )

    expect(results.filter((r) => r === 'booked')).toHaveLength(1)
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(4)

    // Losing the race must look like a full class, not like a crash. If the
    // seat check were a plain read-then-write, the losers would surface as
    // check-constraint violations here instead — a 500 for the parent.
    for (const result of results) {
      if (result === 'booked') continue
      expect(['CLASS_FULL', 'DUPLICATE_BOOKING']).toContain(result)
    }
  })

  it('sells exactly four seats when a rush hits an empty class', async () => {
    await query('UPDATE trial_classes SET seats_taken = 0 WHERE id = $1', [IDS.classOneSeatLeft])
    await query(`DELETE FROM bookings WHERE trial_class_id = $1`, [IDS.classOneSeatLeft])

    const students = [IDS.chloe, IDS.ethan, IDS.kiran, IDS.aisyah, IDS.marcus, IDS.olivia]
    const results = await Promise.all(
      students.flatMap((studentId) =>
        Array.from({ length: 3 }, () =>
          createBooking({ studentId, trialClassId: IDS.classOneSeatLeft })
            .then(() => 'booked' as const)
            .catch(asErrorCode),
        ),
      ),
    )

    expect(results.filter((r) => r === 'booked')).toHaveLength(4)
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(4)

    for (const result of results) {
      if (result === 'booked') continue
      expect(['CLASS_FULL', 'DUPLICATE_BOOKING']).toContain(result)
    }
  })
})

describe('expired holds', () => {
  it('puts the seat back on sale when the hold runs out', async () => {
    const booking = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classOneSeatLeft })
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(4)

    await forceExpireHold(booking.id)
    const released = await expireHolds()

    expect(released).toBe(1)
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(3)

    const rows = await query<{ status: string }>('SELECT status FROM bookings WHERE id = $1', [
      booking.id,
    ])
    expect(rows[0].status).toBe('expired')
  })

  it('is idempotent when the job runs twice', async () => {
    const booking = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classOneSeatLeft })
    await forceExpireHold(booking.id)

    expect(await expireHolds()).toBe(1)
    expect(await expireHolds()).toBe(0)
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(3)
  })
})

describe('payment webhooks', () => {
  it('ignores a replayed provider reference instead of taking a second seat', async () => {
    const booking = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classWithSeats })

    const first = await settlePayment({
      bookingId: booking.id,
      outcome: 'success',
      providerRef: 'mock_ref_replay',
    })
    const replay = await settlePayment({
      bookingId: booking.id,
      outcome: 'success',
      providerRef: 'mock_ref_replay',
    })

    expect(first.booking.status).toBe('confirmed')
    expect(replay.booking.status).toBe('confirmed')
    expect(replay.payment.id).toBe(first.payment.id)
    expect(await seatsTaken(IDS.classWithSeats)).toBe(2)
  })
})

describe('cancellation', () => {
  it('cancels a pending booking and releases the seat immediately', async () => {
    const booking = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classOneSeatLeft })
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(4)

    const cancelled = await cancelBooking(booking.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.hold_expires_at).toBeNull()
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(3)

    // Another parent can immediately grab the freed seat
    const other = await createBooking({ studentId: IDS.chloe, trialClassId: IDS.classOneSeatLeft })
    expect(other.status).toBe('pending_payment')
    expect(await seatsTaken(IDS.classOneSeatLeft)).toBe(4)
  })

  it('allows the same child to rebook after cancellation', async () => {
    const first = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classWithSeats })
    await cancelBooking(first.id)

    const second = await createBooking({ studentId: IDS.olivia, trialClassId: IDS.classWithSeats })
    expect(second.status).toBe('pending_payment')
    expect(second.id).not.toBe(first.id)
  })
})

