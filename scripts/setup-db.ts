/**
 * Creates the schema and loads the synthetic data.
 *
 *   npm run db:setup            -> schema + seed on DATABASE_URL
 *   npm run db:setup -- --schema-only
 *   TEST_DATABASE_URL=... npm run db:setup -- --test
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import './load-env'

const root = join(process.cwd(), 'db')

async function main() {
  const useTestDb = process.argv.includes('--test')
  const schemaOnly = process.argv.includes('--schema-only')

  const connectionString = useTestDb
    ? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
    : process.env.DATABASE_URL

  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.')
    process.exit(1)
  }

  const client = new Client({ connectionString })
  await client.connect()

  await client.query(readFileSync(join(root, 'schema.sql'), 'utf8'))
  console.log('schema applied')

  if (!schemaOnly) {
    await client.query(readFileSync(join(root, 'seed.sql'), 'utf8'))
    console.log('seed data loaded')
  }

  await client.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
