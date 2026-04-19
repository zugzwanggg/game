import 'dotenv/config'
import { pool } from '../db/pool.js'

const WDQS = 'https://query.wikidata.org/sparql'
const WD_FETCH_MS = 120_000

type Draft = {
  name: string
  type: 'character' | 'person'
  category: string
  popularity_score: number
  tags: string[]
  image_url: string | null
  external_source: Record<string, unknown>
}

type CharacterMediaKind = 'film' | 'tv' | 'comics' | 'video_game' | 'animated' | 'literary'

type CharacterRow = {
  qid: string
  name: string
  media: CharacterMediaKind
  sitelinks: number
  image_url: string
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

function qidFromUri(uri: string): string | null {
  const m = String(uri).match(/entity\/(Q\d+)/i)
  return m ? m[1]! : null
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
      'User-Agent': 'unplyd-seed-whoami-dataset/1.0',
    },
    body,
    signal: AbortSignal.timeout(WD_FETCH_MS),
  })
  const text = await res.text()
  if ((res.status === 504 || res.status === 502 || res.status === 503) && attempt < 4) {
    await sleep(2500 * (attempt + 1))
    return wikidataSparqlJson(query, attempt + 1)
  }
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}: ${text.slice(0, 500)}`)
  const json = JSON.parse(text) as { results?: { bindings?: Record<string, { value: string }>[] } }
  return json.results?.bindings ?? []
}

function badCharacterLabel(label: string): boolean {
  const s = label.trim()
  if (s.length < 2 || s.length > 80) return true
  const l = s.toLowerCase()
  if (/^list of\b|^category:/i.test(l)) return true
  if (/unnamed|unknown character|unidentified/i.test(l)) return true
  if (/\b(god|goddess|deity|demigod)\b/i.test(l)) return true
  if (/\b(avatar of|incarnation of|consort of|son of|daughter of)\b/i.test(l)) return true
  return false
}

const CHARACTER_CLASS_Q: ReadonlyArray<{ id: string; media: CharacterMediaKind }> = [
  { id: 'Q15773347', media: 'film' },
  { id: 'Q15773317', media: 'tv' },
  { id: 'Q1114461', media: 'comics' },
  { id: 'Q1569167', media: 'video_game' },
  { id: 'Q15711870', media: 'animated' },
  { id: 'Q3658341', media: 'literary' },
]

async function fetchCharacterPages(
  floor: number,
  target: number,
  maxOffset: number,
  pageSize: number,
): Promise<CharacterRow[]> {
  const byQid = new Map<string, CharacterRow>()

  for (let offset = 0; offset < maxOffset && byQid.size < target; offset += pageSize) {
    for (let i = 0; i < CHARACTER_CLASS_Q.length; i++) {
      const { id: typeQ, media } = CHARACTER_CLASS_Q[i]!
      const query = `
SELECT ?char ?charLabel ?sl ?img WHERE {
  ?char wdt:P31/wdt:P279* wd:${typeQ} .
  FILTER NOT EXISTS { ?char wdt:P31/wdt:P279* wd:Q178885 }
  FILTER NOT EXISTS { ?char wdt:P31/wdt:P279* wd:Q4271324 }
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
        if (badCharacterLabel(label)) continue
        const qid = qidFromUri(String(b.char?.value ?? ''))
        if (!qid) continue
        const sitelinks = Number(b.sl?.value ?? 0)
        const image_url = imageUrlFromWikidataP18(b.img?.value)
        if (!image_url) continue
        const prev = byQid.get(qid)
        const row: CharacterRow = { qid, name: label, media, sitelinks, image_url }
        if (!prev || sitelinks > prev.sitelinks) byQid.set(qid, row)
      }
      if (i < CHARACTER_CLASS_Q.length - 1) await sleep(300)
    }
  }

  return [...byQid.values()].sort((a, b) => b.sitelinks - a.sitelinks)
}

async function fetchEasyCharacters(target: number): Promise<Draft[]> {
  const pageSize = Math.min(100, Math.max(50, Math.ceil(target / 2) + 15))
  const maxOffset = Math.min(900, Math.max(300, target * 4))
  const floors = [70, 55, 40, 28]
  const seen = new Set<string>()
  const merged: Draft[] = []

  for (const floor of floors) {
    if (merged.length >= target) break
    const rows = await fetchCharacterPages(floor, target * 2, maxOffset, pageSize)
    for (const row of rows) {
      const key = normName(row.name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push({
        name: row.name,
        type: 'character',
        category: 'media',
        popularity_score: row.sitelinks,
        tags: ['wikidata', 'character', row.media, row.qid, `sl${row.sitelinks}`],
        image_url: row.image_url,
        external_source: {
          wikidata: { qid: row.qid, kind: 'media_character', media: row.media, sitelinks: row.sitelinks },
        },
      })
      if (merged.length >= target) break
    }
  }

  return merged.slice(0, target)
}

async function fetchEasyPeople(target: number): Promise<Draft[]> {
  const floors = [150, 130, 115, 100]
  const seen = new Set<string>()
  const merged: Draft[] = []

  for (const floor of floors) {
    if (merged.length >= target) break
    const lim = Math.min(800, Math.max(180, target * 6))
    const query = `
SELECT DISTINCT ?person ?personLabel ?sl ?img ?occLabel WHERE {
  ?person wdt:P31 wd:Q5 .
  ?person wikibase:sitelinks ?sl .
  FILTER(?sl >= ${floor})
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
    for (const b of rows) {
      const name = String(b.personLabel?.value ?? '').trim()
      const key = normName(name)
      if (!key || seen.has(key)) continue
      if (name.length < 2 || name.length > 80) continue
      const qid = qidFromUri(String(b.person?.value ?? ''))
      if (!qid) continue
      const sitelinks = Number(b.sl?.value ?? 0)
      const image_url = imageUrlFromWikidataP18(b.img?.value)
      if (!image_url) continue
      const occ = String(b.occLabel?.value ?? '').toLowerCase()
      const category = occ.includes('actor')
        ? 'actor'
        : occ.includes('singer') || occ.includes('musician')
          ? 'musician'
          : occ.includes('football') || occ.includes('basketball') || occ.includes('athlete')
            ? 'athlete'
            : 'public_figure'
      seen.add(key)
      merged.push({
        name,
        type: 'person',
        category,
        popularity_score: sitelinks * 4,
        tags: ['wikidata', 'person', qid, `sl${sitelinks}`],
        image_url,
        external_source: { wikidata: { qid, sitelinks, occupation: occ || null } },
      })
      if (merged.length >= target) break
    }
  }

  return merged.slice(0, target)
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
        [r.name, r.type, r.category, r.popularity_score, r.tags, r.image_url, JSON.stringify(r.external_source)],
      )
    }
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.exit(1)
  }

  const peopleTarget = Math.floor(envNum('SEED_PEOPLE', 100))
  const characterTarget = Math.floor(envNum('SEED_CHARACTERS', 100))

  const [people, characters] = await Promise.all([
    fetchEasyPeople(peopleTarget),
    fetchEasyCharacters(characterTarget),
  ])

  const merged = [...people, ...characters]
  if (merged.length === 0) process.exit(1)
  await insertRows(merged)
}

main().catch(() => {
  process.exit(1)
})
