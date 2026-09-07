import { NextResponse } from 'next/server'
import { BookingError } from './errors'

/** Turns a thrown BookingError into the response the client expects. */
export function errorResponse(error: unknown) {
  if (error instanceof BookingError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus })
  }
  console.error(error)
  return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' }, { status: 500 })
}
