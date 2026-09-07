import { Pool, type PoolClient } from 'pg'

declare global {
  // Next.js dev mode re-evaluates modules on every change; without this the
  // process leaks a connection pool per reload.
  // eslint-disable-next-line no-var
  var __ottodotPool: Pool | undefined
}

export function getPool(): Pool {
  if (!global.__ottodotPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local first.')
    }
    global.__ottodotPool = new Pool({ connectionString, max: 20 })
  }
  return global.__ottodotPool
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(text, params as never[])
  return result.rows as T[]
}

/**
 * Runs `fn` inside a single transaction on a single connection.
 *
 * Every booking operation goes through here. Using one connection for the whole
 * unit of work is what makes the row locks meaningful — running the same
 * statements on pooled connections would give you no isolation at all.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (global.__ottodotPool) {
    await global.__ottodotPool.end()
    global.__ottodotPool = undefined
  }
}
