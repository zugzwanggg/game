import 'dotenv/config'
import { pool } from '../db/pool.js'
 
// ─── Data ────────────────────────────────────────────────────────────────────
 
interface Entry {
  name: string
  type: string
  category: string
  difficulty: string
  popularity_score: number
  tags: string[]
  fallback_image: string
}
 
const entries: Entry[] = [
  { name: 'Dexter Morgan', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 96, tags: ['tv','crime'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/1/18/Dexter_Morgan.jpg' },
  { name: 'James Doakes', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 90, tags: ['tv','crime'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/7/79/James_Doakes.jpg' },
  { name: 'Walter White', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 100, tags: ['tv','breakingbad'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/0/03/Walter_White_S5B.png' },
  { name: 'Jesse Pinkman', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 98, tags: ['tv','breakingbad'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/c/c6/Jesse_Pinkman_S5B.png' },
  { name: 'Saul Goodman', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 97, tags: ['tv'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/1/16/Saul_Goodman.jpg' },
  { name: 'Gus Fring', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 96, tags: ['tv'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/7/7b/Gustavo_Fring_BCS_S3.png' },
  { name: 'Michael Scott', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 99, tags: ['tv','comedy'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/d/dc/MichaelScott.png' },
  { name: 'Dwight Schrute', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 97, tags: ['tv','comedy'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/c/cd/Dwight_Schrute.png' },
  { name: 'Rick Sanchez', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 99, tags: ['cartoon'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/a/a6/Rick_Sanchez.png' },
  { name: 'Morty Smith', type: 'character', category: 'fiction', difficulty: 'easy', popularity_score: 97, tags: ['cartoon'], fallback_image: 'https://upload.wikimedia.org/wikipedia/en/1/17/Morty_Smith.png' },
  
  // ── Real People (YouTubers + Trump) ─────────────────────
  { name: 'Donald Trump', type: 'person', category: 'politics', difficulty: 'easy', popularity_score: 100, tags: ['usa'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/5/56/Donald_Trump_official_portrait.jpg' },
  
  { name: 'MrBeast', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 100, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/0/0c/MrBeast_2023.jpg' },
  { name: 'PewDiePie', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 100, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/9/9e/PewDiePie_2019.jpg' },
  { name: 'Markiplier', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 98, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Markiplier_2017.jpg' },
  { name: 'Jacksepticeye', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 98, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/0/0f/Jacksepticeye_2019.jpg' },
  { name: 'KSI', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 99, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/6/6e/KSI_2019.jpg' },
  { name: 'Logan Paul', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 99, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/4/4d/Logan_Paul_2019.jpg' },
  { name: 'Jake Paul', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 98, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/8/8e/Jake_Paul_2020.jpg' },
  { name: 'Ryan Trahan', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 96, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/7/7f/Ryan_Trahan_2022.jpg' },
  { name: 'Speed (IShowSpeed)', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 99, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/5/5f/IShowSpeed_2023.jpg' },
  { name: 'Kai Cenat', type: 'person', category: 'youtuber', difficulty: 'easy', popularity_score: 99, tags: ['youtube'], fallback_image: 'https://upload.wikimedia.org/wikipedia/commons/2/2e/Kai_Cenat_2023.jpg' }
]
 
// ─── Wikimedia image fetcher ──────────────────────────────────────────────────
 
/**
 * Fetch the best available image URL from the Wikipedia REST API.
 * Falls back to the original hardcoded URL if anything goes wrong.
 */
async function fetchWikipediaImageUrl(name: string, fallback: string): Promise<string> {
  // The Wikipedia REST summary endpoint returns a `thumbnail` and `originalimage`
  const searchTitle = name
    .replace(/\s*\(.*?\)/g, '') // strip parenthetical disambiguation like "(Death Note)"
    .trim()
    .replace(/ /g, '_')
 
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchTitle)}`
 
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'seeder-script/1.0 (educational project)' },
      signal: AbortSignal.timeout(8_000),
    })
 
    if (!res.ok) {
      console.warn(`Wikipedia error for "${name}" (${res.status}) — using fallback`)
      return fallback
    }
 
    const json = (await res.json()) as {
      originalimage?: { source: string }
      thumbnail?: { source: string }
    }
 
    const imageUrl = json.originalimage?.source ?? json.thumbnail?.source
    if (imageUrl) {
      console.log(`  ✓  ${name} → ${imageUrl.slice(0, 80)}…`)
      return imageUrl
    }
 
    console.warn(`No image in summary for "${name}" — using fallback`)
    return fallback
  } catch (err) {
    console.warn(`Fetch failed for "${name}": ${(err as Error).message} — using fallback`)
    return fallback
  }
}
 
// ─── Main ─────────────────────────────────────────────────────────────────────
 
async function main() {
  console.log(`Fetching images for ${entries.length} entries from Wikipedia…`)

  const enriched: Array<Entry & { image_url: string }> = []
  for (const entry of entries) {
    const image_url = await fetchWikipediaImageUrl(entry.name, entry.fallback_image)
    enriched.push({ ...entry, image_url })
    await sleep(250)
  }

  let updated = 0
  let inserted = 0

  for (const row of enriched) {
    const ext = { source: 'wikipedia_summary_seed', fallback: row.fallback_image }
    const upd = await pool.query(
      `update game_items
       set image_url = $1,
           category = $2,
           difficulty = $3,
           popularity_score = $4,
           tags = $5,
           external_source = coalesce(external_source, '{}'::jsonb) || $6::jsonb
       where name = $7 and type = $8`,
      [
        row.image_url,
        row.category,
        row.difficulty,
        row.popularity_score,
        row.tags,
        JSON.stringify(ext),
        row.name,
        row.type,
      ],
    )
    if (Number(upd.rowCount) > 0) {
      updated++
      continue
    }
    await pool.query(
      `insert into game_items (name, type, category, difficulty, popularity_score, tags, image_url, external_source)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        row.name,
        row.type,
        row.category,
        row.difficulty,
        row.popularity_score,
        row.tags,
        row.image_url,
        JSON.stringify(ext),
      ],
    )
    inserted++
  }

  console.log(`Done: updated ${updated}, inserted ${inserted}.`)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
 
main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})