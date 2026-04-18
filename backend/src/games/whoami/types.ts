export type WhoAmIAssignment = {
  itemId: string
  name: string
  type: 'character' | 'person'
  category: string
  imageUrl: string | null
}

export type WhoAmIDifficultyTier = 'easy' | 'medium' | 'hard' | 'any'

export type WhoAmIItemInput = {
  id: string
  name: string
  type: 'character' | 'person'
  category: string
  imageUrl: string | null
  /** From DB or inferred for fallbacks; used when difficulty filter is not `any`. */
  difficulty?: 'easy' | 'medium' | 'hard'
}
