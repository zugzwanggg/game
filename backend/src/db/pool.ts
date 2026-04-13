import pg from 'pg'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.warn(
    'DATABASE_URL is not set. Configure it in .env before using the database.',
  )
}

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
})

export async function checkDb(): Promise<boolean> {
  if (!connectionString) return false
  const client = await pool.connect()
  try {
    await client.query('select 1')
    return true
  } catch {
    return false
  } finally {
    client.release()
  }
}
