/**
 * The background job. In production this runs on a schedule (every minute is
 * plenty) so seats do not sit dead when nobody happens to be booking.
 *
 *   npm run expire-holds
 */
import './load-env'
import { expireHolds } from '../src/lib/bookings'
import { closePool } from '../src/lib/db'

async function main() {
  const released = await expireHolds()
  console.log(`released ${released} expired hold(s)`)
  await closePool()
}

main().catch(async (error) => {
  console.error(error)
  await closePool()
  process.exit(1)
})
