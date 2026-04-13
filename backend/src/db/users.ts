import { pool } from './pool.js'

export type DbUser = {
  id: string
  email: string
  displayName: string
  passwordHash: string
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
      created_at as "createdAt"
    from app_user
    where email = $1
    limit 1
    `,
    [email],
  )
  return (rows[0] as DbUser | undefined) ?? null
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

