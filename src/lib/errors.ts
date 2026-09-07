export type BookingErrorCode =
  | 'CLASS_NOT_FOUND'
  | 'CLASS_FULL'
  | 'DUPLICATE_BOOKING'
  | 'STUDENT_NOT_FOUND'
  | 'BOOKING_NOT_FOUND'
  | 'BOOKING_NOT_PAYABLE'

const HTTP_STATUS: Record<BookingErrorCode, number> = {
  CLASS_NOT_FOUND: 404,
  STUDENT_NOT_FOUND: 404,
  BOOKING_NOT_FOUND: 404,
  CLASS_FULL: 409,
  DUPLICATE_BOOKING: 409,
  BOOKING_NOT_PAYABLE: 409,
}

export class BookingError extends Error {
  readonly code: BookingErrorCode
  readonly httpStatus: number

  constructor(code: BookingErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.name = 'BookingError'
    this.code = code
    this.httpStatus = HTTP_STATUS[code]
  }
}

const DEFAULT_MESSAGES: Record<BookingErrorCode, string> = {
  CLASS_NOT_FOUND: 'That trial class does not exist.',
  STUDENT_NOT_FOUND: 'That child does not exist.',
  BOOKING_NOT_FOUND: 'That booking does not exist.',
  CLASS_FULL: 'This trial class is full. Please pick another slot.',
  DUPLICATE_BOOKING: 'This child already has a seat or a pending booking in this class.',
  BOOKING_NOT_PAYABLE: 'This booking is not waiting for payment.',
}

/** Postgres unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = '23505'
/** Postgres check-constraint violation SQLSTATE. */
export const CHECK_VIOLATION = '23514'

export function isPgError(error: unknown, code: string, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: string; constraint?: string }
  if (candidate.code !== code) return false
  return constraint ? candidate.constraint === constraint : true
}
