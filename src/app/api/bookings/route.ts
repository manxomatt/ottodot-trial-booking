import { NextResponse } from 'next/server'
import { createBooking, listActiveBookingsForStudent } from '@/lib/bookings'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Opens a booking and holds a seat.
 *
 * An `Idempotency-Key` header (or `idempotencyKey` in the body) makes a retried
 * request return the original booking instead of holding a second seat.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const studentId = searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'studentId query param is required.' },
        { status: 400 },
      )
    }

    const bookings = await listActiveBookingsForStudent(studentId)
    return NextResponse.json({ bookings })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { studentId, trialClassId } = body ?? {}

    if (!studentId || !trialClassId) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'studentId and trialClassId are required.' },
        { status: 400 },
      )
    }

    const booking = await createBooking({
      studentId,
      trialClassId,
      idempotencyKey: request.headers.get('Idempotency-Key') ?? body.idempotencyKey ?? null,
    })

    return NextResponse.json({ booking }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
