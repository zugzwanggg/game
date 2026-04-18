import { pool } from './pool.js'

export type GameItemRow = {
  id: string
  name: string
  type: 'character' | 'person'
  category: string
  difficulty: 'easy' | 'medium' | 'hard'
  popularity_score: number
  tags: string[]
  image_url: string | null
  external_source: unknown
}

/**
 * Random selection for match setup. Small tables: `order by random()` is acceptable at seed scale.
 */
export async function fetchRandomGameItems(
  limit: number,
  itemType?: 'character' | 'person',
  difficulty?: 'easy' | 'medium' | 'hard' | 'any',
): Promise<GameItemRow[]> {
  if (!process.env.DATABASE_URL) return []
  const n = Math.max(1, Math.min(200, Math.floor(limit)))
  if (itemType === 'character' || itemType === 'person') {
    const diff = difficulty ?? 'any'
    if (diff === 'any') {
      const { rows } = await pool.query(
        `select id, name, type, category, difficulty, popularity_score, tags, image_url, external_source
         from game_items
         where type = $2
         order by random()
         limit $1`,
        [n, itemType],
      )
      return rows as GameItemRow[]
    }
    const { rows } = await pool.query(
      `select id, name, type, category, difficulty, popularity_score, tags, image_url, external_source
       from game_items
       where type = $2 and difficulty = $3
       order by random()
       limit $1`,
      [n, itemType, diff],
    )
    return rows as GameItemRow[]
  }
  const { rows } = await pool.query(
    `select id, name, type, category, difficulty, popularity_score, tags, image_url, external_source
     from game_items
     order by random()
     limit $1`,
    [n],
  )
  return rows as GameItemRow[]
}
