import { NextResponse } from 'next/server'
import { cancelBooking, getBooking } from '@/lib/bookings'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const booking = await getBooking(id)
    if (!booking) {
      return NextResponse.json({ error: 'BOOKING_NOT_FOUND' }, { status: 404 })
    }
    return NextResponse.json({ booking })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const booking = await cancelBooking(id)
    return NextResponse.json({ booking, message: 'Booking cancelled and seat released.' })
  } catch (error) {
    return errorResponse(error)
  }
}

