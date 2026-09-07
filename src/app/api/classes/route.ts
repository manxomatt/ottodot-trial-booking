import { NextResponse } from 'next/server'
import { listTrialClasses } from '@/lib/bookings'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ classes: await listTrialClasses() })
  } catch (error) {
    return errorResponse(error)
  }
}
