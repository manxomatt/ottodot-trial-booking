import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPool, query } from '../src/lib/db'

const schemaSql = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8')
const seedSql = readFileSync(join(process.cwd(), 'db', 'seed.sql'), 'utf8')

export async function resetDatabase(): Promise<void> {
  const pool = getPool()
  await pool.query(schemaSql)
  await pool.query(seedSql)
}

export async function seatsTaken(classId: string): Promise<number> {
  const rows = await query<{ seats_taken: number }>(
    'SELECT seats_taken FROM trial_classes WHERE id = $1',
    [classId],
  )
  return Number(rows[0].seats_taken)
}

export async function confirmedCount(classId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*) FROM bookings WHERE trial_class_id = $1 AND status = 'confirmed'`,
    [classId],
  )
  return Number(rows[0].count)
}

/** Fixed IDs from db/seed.sql. */
export const IDS = {
  /** 1 of 4 taken — Chloe already confirmed here. */
  classWithSeats: 'c0000000-0000-0000-0000-000000000001',
  /** 3 of 4 taken — one seat left. */
  classOneSeatLeft: 'c0000000-0000-0000-0000-000000000002',
  /** 4 of 4 taken. */
  classFull: 'c0000000-0000-0000-0000-000000000003',
  /** 1 of 4 taken, has a payment_failed booking in its history. */
  classWithFailedPayment: 'c0000000-0000-0000-0000-000000000004',

  chloe: 'a1111111-0000-0000-0000-000000000001',
  ethan: 'a1111111-0000-0000-0000-000000000002',
  kiran: 'a2222222-0000-0000-0000-000000000001',
  aisyah: 'a3333333-0000-0000-0000-000000000001',
  marcus: 'a4444444-0000-0000-0000-000000000001',
  olivia: 'a4444444-0000-0000-0000-000000000002',

  chloeConfirmedInClass1: 'b0000000-0000-0000-0000-000000000001',
  oliviaFailedBooking: 'b0000000-0000-0000-0000-00000000000a',
}
