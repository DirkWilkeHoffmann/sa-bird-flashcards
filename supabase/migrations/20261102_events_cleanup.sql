-- NOT APPLIED YET (2 Nov 2026): waiting for Dirk to confirm in Supabase. Remove this line once applied.
-- Usage events: keep 100 days of detail (the dashboard looks back at most 90), and fold older
-- events into daily totals every night, so the free 500 MB database never fills up.
-- Progress, accounts, learner profiles and photo/name reviews are never touched.
create extension if not exists pg_cron;

create table if not exists public.events_daily (
  day date not null,
  env text not null,
  type text not null,
  n integer not null,
  players integer not null,
  primary key (day, env, type)
);
alter table public.events_daily enable row level security;  -- no policies: functions only

create or replace function public.fold_old_events(p_keep_days integer default 100)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  cutoff timestamptz := date_trunc('day', now()) - make_interval(days => p_keep_days);
  removed integer;
begin
  insert into public.events_daily (day, env, type, n, players)
  select at::date, env, type, count(*), count(distinct key_hash)
  from public.events where at < cutoff
  group by 1, 2, 3
  on conflict (day, env, type) do update
    set n = public.events_daily.n + excluded.n,
        players = greatest(public.events_daily.players, excluded.players);
  delete from public.events where at < cutoff;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.fold_old_events(integer) from public, anon, authenticated;

-- Every night at 01:17 UTC.
select cron.unschedule(jobid) from cron.job where jobname = 'fold-old-events';
select cron.schedule('fold-old-events', '17 1 * * *', $$select public.fold_old_events(100)$$);
