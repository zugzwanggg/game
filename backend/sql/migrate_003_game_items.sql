-- Who Am I / What Am I — curated identities (seeded offline; not fetched during live matches).

create table if not exists game_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('character', 'person')),
  category text not null,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  popularity_score double precision not null default 0,
  tags text[] not null default '{}',
  image_url text,
  external_source jsonb,
  created_at timestamptz not null default now(),
  constraint game_items_name_nonempty check (char_length(trim(name)) > 0)
);

create index if not exists game_items_type_difficulty_idx on game_items (type, difficulty);
create index if not exists game_items_popularity_idx on game_items (popularity_score desc);
