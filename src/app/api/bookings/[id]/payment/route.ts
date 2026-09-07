import { NextResponse } from 'next/server'
import { settlePayment } from '@/lib/bookings'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Stands in for the payment provider's callback.
 *
 * Body: { outcome: 'success' | 'failure', providerRef?: string, failureReason?: string }
 *
 * `providerRef` is what makes this safe to call twice: a repeated reference
 * returns the original result rather than settling again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const outcome = body?.outcome

    if (outcome !== 'success' && outcome !== 'failure') {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: "outcome must be 'success' or 'failure'." },
        { status: 400 },
      )
    }

    const result = await settlePayment({
      bookingId: id,
      outcome,
      providerRef: body.providerRef ?? null,
      failureReason: body.failureReason ?? null,
    })

    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
