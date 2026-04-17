import { pool } from './pool.js'

export type DbUser = {
  id: string
  email: string
  displayName: string
  passwordHash: string | null
  googleSub: string | null
  createdAt: string
}

export async function createUser(args: {
  email: string
  displayName: string
  passwordHash: string
}): Promise<DbUser> {
  const { rows } = await pool.query(
    `
    insert into app_user (email, display_name, password_hash)
    values ($1, $2, $3)
    returning
      id,
      email,
      display_name as "displayName",
      password_hash as "passwordHash",
      google_sub as "googleSub",
      created_at as "createdAt"
    `,
    [args.email, args.displayName, args.passwordHash],
  )
  return rows[0] as DbUser
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const { rows } = await pool.query(
    `
    select
      id,
      email,
      display_name as "displayName",
      password_hash as "passwordHash",
      google_sub as "googleSub",
      created_at as "createdAt"
    from app_user
    where email = $1
    limit 1
    `,
    [email],
  )
  return (rows[0] as DbUser | undefined) ?? null
}

export async function findUserByGoogleSub(googleSub: string): Promise<DbUser | null> {
  const { rows } = await pool.query(
    `
    select
      id,
      email,
      display_name as "displayName",
      password_hash as "passwordHash",
      google_sub as "googleSub",
      created_at as "createdAt"
    from app_user
    where google_sub = $1
    limit 1
    `,
    [googleSub],
  )
  return (rows[0] as DbUser | undefined) ?? null
}

/** Create or link a Google account; password_hash may be null for OAuth-only users. */
export async function upsertGoogleUser(args: {
  googleSub: string
  email: string
  displayName: string
}): Promise<Pick<DbUser, 'id' | 'email' | 'displayName' | 'passwordHash' | 'googleSub' | 'createdAt'>> {
  const existing = await findUserByGoogleSub(args.googleSub)
  if (existing) {
    await pool.query(
      `update app_user set display_name = $1 where id = $2 and display_name is distinct from $1`,
      [args.displayName, existing.id],
    )
    return { ...existing, displayName: args.displayName }
  }

  const byEmail = await findUserByEmail(args.email)
  if (byEmail) {
    if (byEmail.googleSub && byEmail.googleSub !== args.googleSub) {
      throw new Error('email_google_conflict')
    }
    await pool.query(
      `update app_user set google_sub = $1, display_name = $2 where id = $3`,
      [args.googleSub, args.displayName, byEmail.id],
    )
    return {
      ...byEmail,
      googleSub: args.googleSub,
      displayName: args.displayName,
    }
  }

  const { rows } = await pool.query(
    `
    insert into app_user (email, display_name, password_hash, google_sub)
    values ($1, $2, null, $3)
    returning
      id,
      email,
      display_name as "displayName",
      password_hash as "passwordHash",
      google_sub as "googleSub",
      created_at as "createdAt"
    `,
    [args.email, args.displayName, args.googleSub],
  )
  return rows[0] as DbUser
}

export async function findUserById(id: string): Promise<Pick<DbUser, 'id' | 'email' | 'displayName' | 'createdAt'> | null> {
  const { rows } = await pool.query(
    `
    select
      id,
      email,
      display_name as "displayName",
      created_at as "createdAt"
    from app_user
    where id = $1
    limit 1
    `,
    [id],
  )
  return (rows[0] as any) ?? null
}

