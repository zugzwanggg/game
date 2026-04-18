/**
 * Offline seed: globally recognizable characters + real people (Who Am I dataset).
 * Run: `npm run seed:game-items` from backend/ (needs DATABASE_URL).
 *
 * Wikidata-only (no TMDB):
 * - Characters: only mass-media character types (film / TV / comics / games / animation / literature),
 *   ranked by sitelinks, paged per type.
 * - People: humans with high sitelinks + curated occupations + Commons image.
 *
 * All saved rows use difficulty "easy" (quality bar replaces easy/medium/hard split).
 */
import 'dotenv/config'
import { pool } from '../db/pool.js'

const WDQS = 'https://query.wikidata.org/sparql'

type Draft = {
  name: string
  type: 'character' | 'person'
  category: string
  popularity_score: number
  tags: string[]
  image_url: string | null
  external_source: Record<string, unknown>
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '')
}

function imageUrlFromWikidataP18(raw: string | null | undefined, width = 500): string | null {
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

const WD_FETCH_MS = 120_000

async function wikidataSparqlJson(
  query: string,
  attempt = 0,
): Promise<Record<string, { value: string }>[]> {
  const body = new URLSearchParams()
  body.set('query', query)
  const res = await fetch(WDQS, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'unplyd-seed-game-items/2.0 (wikidata-only)',
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

function badLabel(label: string): boolean {
  const s = label.trim()
  if (s.length < 2 || s.length > 80) return true
  const l = s.toLowerCase()
  if (/^list of\b|^category:/i.test(l)) return true
  if (/unnamed|unknown character|unidentified/i.test(l)) return true
  if (/\b(avatar of|incarnation of|consort of|son of|daughter of)\b.*\b(god|goddess|devi|deva)\b/i.test(l))
    return true
  if (/\b(god|goddess|deity|demigod)\s*(\(|,|\s+of\s+)/i.test(l)) return true
  return false
}

const CHARACTER_CLASS_Q = [
  { id: 'Q15773347', kind: 'film' },
  { id: 'Q15773317', kind: 'tv' },
  { id: 'Q1114461', kind: 'comics' },
  { id: 'Q1569167', kind: 'video_game' },
  { id: 'Q15711870', kind: 'animated' },
  { id: 'Q3658341', kind: 'literary' },
] as const

type CharRow = {
  name: string
  popularity_score: number
  tags: string[]
  image_url: string
  external_source: object
  qid: string
}

async function wikidataMediaCharactersDrafts(opts: {
  minSitelinks: number
  limit: number
}): Promise<Draft[]> {
  const want = Math.max(1, opts.limit)
  const floor = Math.max(28, Math.floor(opts.minSitelinks))
  const pageSize = Math.min(100, Math.max(55, Math.ceil(want / 2) + 15))
  const maxOffset = Math.min(450, Math.max(200, want * 3))

  const byQid = new Map<string, CharRow>()
  for (let offset = 0; offset < maxOffset && byQid.size < want; offset += pageSize) {
    if (offset > 0) {
      console.warn(`Characters: ${byQid.size}/${want} so far; paging OFFSET ${offset}…`)
    }
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
LIMIT ${pageSize}
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
      if (i < CHARACTER_CLASS_Q.length - 1) await sleep(350)
    }
  }

  return [...byQid.values()]
    .sort((a, b) => b.popularity_score - a.popularity_score)
    .slice(0, want)
    .map((r) => ({
      name: r.name,
      type: 'character',
      category: 'media',
      popularity_score: r.popularity_score,
      tags: r.tags,
      image_url: r.image_url,
      external_source: r.external_source as Record<string, unknown>,
    }))
}

async function wikidataPeopleDrafts(opts: { minSitelinks: number; limit: number }): Promise<Draft[]> {
  const minSl = Math.floor(opts.minSitelinks)
  const lim = Math.min(700, Math.max(120, opts.limit * 6))
  const query = `
SELECT DISTINCT ?person ?personLabel ?sl ?img WHERE {
  ?person wdt:P31 wd:Q5 .
  ?person wikibase:sitelinks ?sl .
  FILTER(?sl >= ${Math.floor(minSl)})
  VALUES ?occ {
    wd:Q33999 wd:Q177220 wd:Q639669 wd:Q43845 wd:Q131524 wd:Q205375
    wd:Q937857 wd:Q3665646 wd:Q19204627 wd:Q2526255
  }
  ?person wdt:P106 ?occ .
  ?person wdt:P18 ?img .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sl)
LIMIT ${lim}
`.trim()

  const rows = await wikidataSparqlJson(query)
  const out: Draft[] = []
  const seen = new Set<string>()
  for (const b of rows) {
    const label = String(b.personLabel?.value ?? '').trim()
    const key = normName(label)
    if (!key || seen.has(key)) continue
    if (label.length < 2 || label.length > 80) continue
    const sl = Number(b.sl?.value ?? 0)
    const qid = qidFromUri(String(b.person?.value ?? ''))
    if (!qid) continue
    const img = imageUrlFromWikidataP18(b.img?.value)
    if (!img) continue
    seen.add(key)
    out.push({
      name: label,
      type: 'person',
      category: 'public_figure',
      popularity_score: sl * 4,
      tags: ['wikidata', 'person', `sl${sl}`, qid],
      image_url: img,
      external_source: { wikidata: { qid, sitelinks: sl } },
    })
    if (out.length >= opts.limit) break
  }
  return out
}

async function insertRows(rows: Draft[]) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('delete from game_items')
    for (const r of rows) {
      await client.query(
        `insert into game_items (name, type, category, difficulty, popularity_score, tags, image_url, external_source)
         values ($1,$2,$3,'easy',$4,$5,$6,$7::jsonb)`,
        [
          r.name,
          r.type,
          r.category,
          r.popularity_score,
          r.tags,
          r.image_url,
          JSON.stringify(r.external_source),
        ],
      )
    }
    await client.query('commit')
    console.log(`Inserted ${rows.length} game_items (all easy).`)
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const charTarget = Math.floor(envNum('SEED_CHARACTERS', 100))
  const peopleTarget = Math.floor(envNum('SEED_PEOPLE', 100))
  const charMinSl = Math.floor(envNum('SEED_WD_CHAR_MIN_SITELINKS', 55))
  const peopleMinSl = Math.floor(envNum('SEED_WD_MIN_SITELINKS', 105))

  console.log('Fetching Wikidata (strict; wikidata-only)…')
  const [chars, people] = await Promise.all([
    wikidataMediaCharactersDrafts({ minSitelinks: charMinSl, limit: charTarget }),
    wikidataPeopleDrafts({ minSitelinks: peopleMinSl, limit: peopleTarget }),
  ])

  const merged = [...chars, ...people]

  if (merged.length === 0) {
    console.error('No rows collected (Wikidata error or empty results).')
    process.exit(1)
  }

  console.log(`Characters: ${chars.length}, People: ${people.length}, Total: ${merged.length}`)
  await insertRows(merged)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
