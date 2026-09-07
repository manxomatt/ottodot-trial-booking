import { NextResponse } from 'next/server'
import { getRoster } from '@/lib/bookings'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

/** The roster a teacher or ops person reads before class. Confirmed seats only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json(await getRoster(id))
  } catch (error) {
    return errorResponse(error)
  }
}
