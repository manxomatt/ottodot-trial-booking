import { existsSync } from 'node:fs'
import { config } from 'dotenv'

for (const file of ['.env.test.local', '.env.local', '.env']) {
  if (existsSync(file)) config({ path: file })
}

// Tests always run against the test database, never the dev one.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}

if (!process.env.DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) before running the tests.')
}
