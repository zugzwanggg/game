/**
 * Offline seed: globally recognizable fictional characters from Wikidata only.
 * Keeps characters tied to mass media (film / TV / comics / games / animation / literature),
 * excludes deities, Hindu/Greek gods, and broad “mythical character” types.
 * Replaces only `game_items` where type = 'character'; leaves `person` rows untouched.
 *
 * Run from backend/: `npm run seed:wikidata-characters`
 * Needs: DATABASE_URL (no TMDB).
 */
import 'dotenv/config'
import { pool } from '../db/pool.js'

const WDQS = 'https://query.wikidata.org/sparql'

function envNum(name: string, fallback: number): number {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * P18 in SPARQL is often `commons.wikimedia.org/wiki/File:…` (not Special:FilePath).
 * Without handling File: URLs we drop most rows.
 */
function imageUrlFromWikidataP18(raw: string | null | undefined, width = 400): string | null {
  if (!raw || typeof raw !== 'string') return null
  const fixed = raw.startsWith('http:') ? `https${raw.slice(4)}` : raw
  try {
    if (fixed.includes('Special:FilePath/')) {
      const u = new URL(fixed)
      u.searchParams.set('width', String(width))
      return u.href
    }
    const u = new URL(fixed)
    if (u.hostname.includes('commons.wikimedia.org') && u.pathname.includes('/wiki/File:')) {
      const title = decodeURIComponent(u.pathname.slice('/wiki/'.length))
      if (!title.startsWith('File:')) return null
      const name = title.slice('File:'.length)
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`
    }
    if (fixed.includes('upload.wikimedia.org')) return fixed
  } catch {
    return null
  }
  return null
}

function qidFromUri(uri: string): string | null {
  const m = String(uri).match(/entity\/(Q\d+)/i)
  return m ? m[1]! : null
}

function badLabel(label: string): boolean {
  const s = label.trim()
  if (s.length < 2 || s.length > 80) return true
  const l = s.toLowerCase()
  if (/^list of\b|^category:/i.test(l)) return true
  if (/unnamed|unknown character|unidentified/i.test(l)) return true
  // Extra guardrails when WD typing is imperfect
  if (/\b(avatar of|incarnation of|consort of|son of|daughter of)\b.*\b(god|goddess|devi|deva)\b/i.test(l))
    return true
  if (/\b(god|goddess|deity|demigod)\s*(\(|,|\s+of\s+)/i.test(l)) return true
  return false
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** One small query per type avoids WDQS 504 on huge combined graphs. */
const CHARACTER_CLASS_Q = [
  { id: 'Q15773347', kind: 'film' },
  { id: 'Q15773317', kind: 'tv' },
  { id: 'Q1114461', kind: 'comics' },
  { id: 'Q1569167', kind: 'video_game' },
  { id: 'Q15711870', kind: 'animated' },
  { id: 'Q3658341', kind: 'literary' },
] as const

const WD_FETCH_MS = 120_000

async function wikidataSparqlJson(query: string, attempt = 0): Promise<Record<string, { value: string }>[]> {
  const body = new URLSearchParams()
  body.set('query', query)
  const res = await fetch(WDQS, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'unplyd-seed-wikidata-characters/1.1 (batch; contact: local dev)',
    },
    body,
    signal: AbortSignal.timeout(WD_FETCH_MS),
  })
  const text = await res.text()
  if ((res.status === 504 || res.status === 502 || res.status === 503) && attempt < 4) {
    const wait = 2500 * (attempt + 1)
    console.warn(`Wikidata SPARQL ${res.status}, retrying in ${wait}ms…`)
    await sleep(wait)
    return wikidataSparqlJson(query, attempt + 1)
  }
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}: ${text.slice(0, 500)}`)
  const json = JSON.parse(text) as { results?: { bindings?: Record<string, { value: string }>[] } }
  return json.results?.bindings ?? []
}

type CharRow = {
  name: string
  popularity_score: number
  tags: string[]
  image_url: string
  external_source: object
  qid: string
}

async function fetchCharactersPage(
  floor: number,
  perTypeLimit: number,
  offset: number,
  byQid: Map<string, CharRow>,
): Promise<void> {
  for (let i = 0; i < CHARACTER_CLASS_Q.length; i++) {
    const { id: typeQ, kind } = CHARACTER_CLASS_Q[i]!
    const query = `
SELECT ?char ?charLabel ?sl ?img WHERE {
  ?char wdt:P31/wdt:P279* wd:${typeQ} .
  ?char wikibase:sitelinks ?sl .
  FILTER(?sl >= ${floor})
  ?char wdt:P18 ?img .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sl)
LIMIT ${perTypeLimit}
OFFSET ${offset}
`.trim()

    const bindings = await wikidataSparqlJson(query)
    for (const b of bindings) {
      const label = String(b.charLabel?.value ?? '').trim()
      if (badLabel(label)) continue
      const sl = Number(b.sl?.value ?? 0)
      const qid = qidFromUri(String(b.char?.value ?? ''))
      if (!qid) continue
      const img = imageUrlFromWikidataP18(b.img?.value)
      if (!img) continue
      const prev = byQid.get(qid)
      const row: CharRow = {
        name: label,
        popularity_score: sl,
        tags: ['wikidata', 'character', kind, qid, `sl${sl}`],
        image_url: img,
        external_source: { wikidata: { qid, kind: 'media_character', media: kind, sitelinks: sl } },
        qid,
      }
      if (!prev || sl > prev.popularity_score) byQid.set(qid, row)
    }
    if (i < CHARACTER_CLASS_Q.length - 1) await sleep(450)
  }
}

async function wikidataPopularCharacters(opts: {
  minSitelinks: number
  limit: number
}): Promise<
  { name: string; popularity_score: number; tags: string[]; image_url: string; external_source: object }[]
> {
  const want = Math.max(1, opts.limit)
  const startMin = Math.max(28, Math.floor(opts.minSitelinks))
  /** Rows per type per page (WDQS: keep moderate to avoid timeouts). */
  const pageSize = Math.min(100, Math.max(50, Math.ceil(want / 2) + 15))
  /** How far to paginate (OFFSET) per type until we have enough distinct items. */
  const maxOffset = Math.min(450, Math.max(200, want * 3))

  const byQid = new Map<string, CharRow>()

  for (let offset = 0; offset < maxOffset && byQid.size < want; offset += pageSize) {
    if (offset > 0) {
      console.warn(
        `Only ${byQid.size} unique characters so far; fetching next page (OFFSET ${offset})…`,
      )
    }
    await fetchCharactersPage(startMin, pageSize, offset, byQid)
  }

  if (byQid.size < want) {
    const floor2 = Math.max(28, startMin - 15)
    if (floor2 < startMin) {
      console.warn(
        `Still ${byQid.size}/${want} after paging; loosening min sitelinks to ≥ ${floor2} (extra pass)…`,
      )
      for (let offset = 0; offset < maxOffset && byQid.size < want; offset += pageSize) {
        await fetchCharactersPage(floor2, pageSize, offset, byQid)
      }
    }
  }

  const merged = [...byQid.values()]
    .sort((a, b) => b.popularity_score - a.popularity_score)
    .slice(0, want)
    .map(({ qid: _q, ...rest }) => rest)

  return merged
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  const target = Math.floor(envNum('SEED_WD_CHARACTERS', 100))
  const minSl = Math.floor(envNum('SEED_WD_CHAR_MIN_SITELINKS', 55))

  console.log(
    `Fetching up to ${target} Wikidata media characters (min sitelinks ${minSl}; paged per media type)…`,
  )
  const rows = await wikidataPopularCharacters({ minSitelinks: minSl, limit: target })
  if (rows.length === 0) {
    console.error('No characters from Wikidata (query empty or blocked).')
    process.exit(1)
  }
  if (rows.length < target) {
    console.warn(
      `Got ${rows.length}/${target} characters. Lower SEED_WD_CHAR_MIN_SITELINKS (e.g. 40) or raise paging in script if you need more.`,
    )
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    const del = await client.query(`delete from game_items where type = 'character'`)
    console.log(`Removed ${del.rowCount ?? 0} existing character rows.`)
    for (const r of rows) {
      await client.query(
        `insert into game_items (name, type, category, difficulty, popularity_score, tags, image_url, external_source)
         values ($1,'character','media','easy',$2,$3,$4,$5::jsonb)`,
        [r.name, r.popularity_score, r.tags, r.image_url, JSON.stringify(r.external_source)],
      )
    }
    await client.query('commit')
    console.log(`Inserted ${rows.length} character game_items from Wikidata.`)
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
