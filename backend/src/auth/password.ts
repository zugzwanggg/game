import bcrypt from 'bcryptjs'

const DEFAULT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12)

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, DEFAULT_ROUNDS)
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return await bcrypt.compare(password, passwordHash)
}

