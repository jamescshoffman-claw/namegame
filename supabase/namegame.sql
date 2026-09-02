-- ===========================================================================
--  NameGame — Supabase schema
--  Run this once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--  Safe to run more than once (every step is guarded or idempotent).
--
--  The game has no login. The browser talks to Supabase with the public
--  publishable key, so security relies on:
--    1. RLS: clients can INSERT a run and UPDATE (upsert) only by knowing a
--       row's random client_id; raw rows are never SELECTable from the client.
--    2. The namegame_stats() function (security definer) exposes only
--       aggregate counts for a day — nothing per-player leaves the database.
--    3. CHECK constraints keep scores sane.
-- ===========================================================================

-- One finished daily climb per browser (client_id is a random UUID the
-- browser generates once and keeps in localStorage).
create table if not exists public.namegame_runs (
  id         bigint generated always as identity primary key,
  day        int  not null check (day >= 0 and day < 40000),
  client_id  uuid not null,
  score      int  not null check (score >= 0 and score <= 500),
  breakdown  jsonb,
  created_at timestamptz not null default now(),
  unique (day, client_id)
);

create index if not exists namegame_runs_day_score
  on public.namegame_runs (day, score);

alter table public.namegame_runs enable row level security;

-- PostgREST needs table privileges AND a passing RLS policy.
grant usage on schema public to anon, authenticated;
grant insert, update on public.namegame_runs to anon, authenticated;

-- Post a run (the client upserts, so replays of the same day update the row).
drop policy if exists "namegame: anyone can post a run" on public.namegame_runs;
create policy "namegame: anyone can post a run"
  on public.namegame_runs for insert
  to public
  with check (true);

drop policy if exists "namegame: replays update a row" on public.namegame_runs;
create policy "namegame: replays update a row"
  on public.namegame_runs for update
  to public
  using (true)
  with check (true);

-- No select policy on purpose: aggregates only, via the function below.
create or replace function public.namegame_stats(p_day int, p_score int)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'players', count(*),
    'below',   count(*) filter (where score < p_score)
  )
  from public.namegame_runs
  where day = p_day;
$$;

revoke all on function public.namegame_stats(int, int) from public;
grant execute on function public.namegame_stats(int, int) to anon, authenticated;
