import { pool } from './pool.js'

export type UserGameStats = {
  userId: string
  game: string
  gamesPlayed: number
  wins: number
  totalPoints: number
  bestScore: number
  updatedAt: string
}

export async function getStatsForUser(userId: string): Promise<UserGameStats[]> {
  const { rows } = await pool.query(
    `
    select
      user_id as "userId",
      game,
      games_played as "gamesPlayed",
      wins,
      total_points as "totalPoints",
      best_score as "bestScore",
      updated_at as "updatedAt"
    from user_game_stats
    where user_id = $1
    order by updated_at desc
    `,
    [userId],
  )
  return rows as UserGameStats[]
}

export async function recordGameResult(args: {
  userId: string
  game: string
  didWin: boolean
  points: number
}): Promise<UserGameStats> {
  const { rows } = await pool.query(
    `
    insert into user_game_stats (user_id, game, games_played, wins, total_points, best_score, updated_at)
    values ($1, $2, 1, $3, $4, $5, now())
    on conflict (user_id, game) do update set
      games_played = user_game_stats.games_played + 1,
      wins = user_game_stats.wins + excluded.wins,
      total_points = user_game_stats.total_points + excluded.total_points,
      best_score = greatest(user_game_stats.best_score, excluded.best_score),
      updated_at = now()
    returning
      user_id as "userId",
      game,
      games_played as "gamesPlayed",
      wins,
      total_points as "totalPoints",
      best_score as "bestScore",
      updated_at as "updatedAt"
    `,
    [
      args.userId,
      args.game,
      args.didWin ? 1 : 0,
      args.points,
      args.points,
    ],
  )
  return rows[0] as UserGameStats
}

