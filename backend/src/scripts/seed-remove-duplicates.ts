import 'dotenv/config'
import { pool } from '../db/pool.js'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  console.log('Scanning game_items for duplicate (name, type) groups…')

  const { rows: duplicates } = await pool.query<{
    name: string
    type: string
    ids: string[]
    count: number
  }>(`
    select
      name,
      type,
      array_agg(id order by created_at asc nulls last, id) as ids,
      count(*)::int as count
    from public.game_items
    group by name, type
    having count(*) > 1
    order by name, type
  `)

  if (duplicates.length === 0) {
    console.log('No duplicates found.')
    return
  }

  console.log(`Found ${duplicates.length} duplicate group(s):`)
  for (const row of duplicates) {
    const keep = row.ids[0]
    console.log(`  "${row.name}" (${row.type}) → ids [${row.ids.join(', ')}] (${row.count} rows, keeping ${keep})`)
  }

  const idsToDelete = duplicates.flatMap(({ ids }) => ids.slice(1))
  if (idsToDelete.length === 0) {
    console.log('Nothing to delete.')
    return
  }

  console.log(`Deleting ${idsToDelete.length} row(s)…`)

  const result = await pool.query(`delete from public.game_items where id = any($1::uuid[])`, [idsToDelete])

  console.log(`Done: ${result.rowCount} row(s) deleted.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
