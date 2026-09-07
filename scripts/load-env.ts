import { existsSync } from 'node:fs'
import { config } from 'dotenv'

// Same precedence Next.js uses, so scripts and the app always agree.
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) config({ path: file })
}
