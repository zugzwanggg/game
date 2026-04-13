-- Backend MVP schema (Neon/Postgres)
-- Only signed-up user data is persisted; rooms/guests are in-memory and short-lived.

create extension if not exists pgcrypto;

create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists app_user_created_at_idx on app_user (created_at desc);

-- Registered user stats (guests are not persisted).
create table if not exists user_game_stats (
  user_id uuid not null references app_user(id) on delete cascade,
  game text not null,
  games_played integer not null default 0,
  wins integer not null default 0,
  total_points integer not null default 0,
  best_score integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);

create index if not exists user_game_stats_updated_at_idx on user_game_stats (updated_at desc);

