-- 1) Create dedicated waiver wire table
create table if not exists public.waiver_wire_players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  espn_league_id text not null,
  season integer not null,
  week integer not null,
  player_id text not null,
  player_name text not null,
  position text not null,
  team text,
  waiver_status text not null default 'FREEAGENT',
  percent_owned numeric default 0,
  percent_started numeric default 0,
  provider_ids jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint waiver_wire_unique unique (league_id, season, week, player_id)
);

-- 2) Add trigger to maintain updated_at
create trigger update_waiver_wire_players_updated_at
before update on public.waiver_wire_players
for each row execute function public.update_updated_at_column();

-- 3) Enable RLS
alter table public.waiver_wire_players enable row level security;

-- 4) Policies: users can read their league waiver data; service can manage all
create policy "Users can view their league waiver wire"
  on public.waiver_wire_players
  for select
  using (
    exists (
      select 1 from public.connected_leagues cl
      where cl.id = waiver_wire_players.league_id
        and cl.user_id = auth.uid()
    )
  );

create policy "Service can manage waiver wire"
  on public.waiver_wire_players
  for all
  using (true)
  with check (true);

-- 5) Helpful indexes
create index if not exists idx_waiver_wire_league_week on public.waiver_wire_players (league_id, season, week);
create index if not exists idx_waiver_wire_player on public.waiver_wire_players (player_id);
