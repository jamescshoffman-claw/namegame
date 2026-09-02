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

-- The table is fully locked to clients: no policies, no direct privileges.
-- All access goes through the two security-definer functions below (an
-- upsert via ON CONFLICT would otherwise need a SELECT policy, which would
-- expose everyone's rows).
alter table public.namegame_runs enable row level security;
drop policy if exists "namegame: anyone can post a run" on public.namegame_runs;
drop policy if exists "namegame: replays update a row" on public.namegame_runs;
revoke all on public.namegame_runs from anon, authenticated;

-- Running per-day aggregates: climb count and total branches, maintained by
-- namegame_submit so the average is a cheap lookup (and a handy dashboard
-- table: select * from namegame_days order by day).
create table if not exists public.namegame_days (
  day    int primary key,
  climbs int    not null default 0,
  total  bigint not null default 0
);
alter table public.namegame_days enable row level security;
revoke all on public.namegame_days from anon, authenticated;

-- Backfill aggregates from any runs recorded before this table existed.
insert into public.namegame_days (day, climbs, total)
select day, count(*), sum(score) from public.namegame_runs group by day
on conflict (day) do update set climbs = excluded.climbs, total = excluded.total;

-- Post (or replay-update) a run, keeping the day aggregates in step.
-- Table CHECK constraints still apply.
create or replace function public.namegame_submit(
  p_day int, p_client uuid, p_score int, p_breakdown jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_score int;
begin
  select score into old_score from namegame_runs
    where day = p_day and client_id = p_client;
  if old_score is null then
    insert into namegame_runs (day, client_id, score, breakdown)
      values (p_day, p_client, p_score, p_breakdown);
    insert into namegame_days as d (day, climbs, total)
      values (p_day, 1, p_score)
      on conflict (day) do update
        set climbs = d.climbs + 1, total = d.total + excluded.total;
  else
    update namegame_runs set score = p_score, breakdown = p_breakdown
      where day = p_day and client_id = p_client;
    update namegame_days set total = total + (p_score - old_score)
      where day = p_day;
  end if;
end;
$$;

revoke all on function public.namegame_submit(int, uuid, int, jsonb) from public;
grant execute on function public.namegame_submit(int, uuid, int, jsonb) to anon, authenticated;

-- Aggregate-only stats for a day: player count, how many scored below you,
-- and the day's average climb.
create or replace function public.namegame_stats(p_day int, p_score int)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'players', coalesce((select climbs from namegame_days where day = p_day), 0),
    'below',   (select count(*) from namegame_runs where day = p_day and score < p_score),
    'avg',     (select round(total::numeric / nullif(climbs, 0), 1)
                from namegame_days where day = p_day)
  );
$$;

revoke all on function public.namegame_stats(int, int) from public;
grant execute on function public.namegame_stats(int, int) to anon, authenticated;
