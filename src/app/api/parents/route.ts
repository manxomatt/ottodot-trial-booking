import { NextResponse } from 'next/server'
import { listParentsWithStudents } from '@/lib/bookings'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ parents: await listParentsWithStudents() })
  } catch (error) {
    return errorResponse(error)
  }
}
