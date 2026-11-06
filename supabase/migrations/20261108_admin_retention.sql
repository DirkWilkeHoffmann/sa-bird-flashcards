-- Do new players come back? For the dashboard. Players are grouped by the week (and, for the last 14
-- days, the day) they first played, in South African time. For each group:
--   n            new players
--   back_n       played again on a later day        (back_of: how many have had a later day yet)
--   week_n       still played 7 or more days later  (week_of: how many started at least 7 days ago)
--   month_n      still played 30 or more days later (month_of: how many started at least 30 days ago)
--   avg_days     average number of days played
-- Rates are worked out of the *_of counts, so players who haven't had the time yet don't pull them down.
-- Built from usage events, which are kept for 100 days, so at most 90 days are looked at.
create or replace function public.admin_retention(p_key text, p_env text default 'main', p_days integer default 90)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(1, least(p_days, 90)) - 1);
  today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  return (
    with p as (
      select key_hash, min(at) f, max(at) l,
             count(distinct (at at time zone 'Africa/Johannesburg')::date) days
      from public.events where env = p_env
      group by key_hash
      having min(at) >= since
    ),
    groups as (
      select 'week' kind, date_trunc('week', f at time zone 'Africa/Johannesburg')::date start, p.* from p
      union all
      select 'day', (f at time zone 'Africa/Johannesburg')::date, p.* from p
      where (f at time zone 'Africa/Johannesburg')::date > today - 14
    ),
    summary as (
      select kind, start, count(*) n,
        count(*) filter (where (f at time zone 'Africa/Johannesburg')::date < today) back_of,
        count(*) filter (where (l at time zone 'Africa/Johannesburg')::date > (f at time zone 'Africa/Johannesburg')::date) back_n,
        count(*) filter (where f <= now() - interval '7 days') week_of,
        count(*) filter (where f <= now() - interval '7 days' and l >= f + interval '7 days') week_n,
        count(*) filter (where f <= now() - interval '30 days') month_of,
        count(*) filter (where f <= now() - interval '30 days' and l >= f + interval '30 days') month_n,
        round(avg(days), 1) avg_days
      from groups group by kind, start
    )
    select jsonb_build_object(
      'weeks', coalesce((select jsonb_agg(to_jsonb(s) - 'kind' order by start) from summary s where kind = 'week'), '[]'),
      'days', coalesce((select jsonb_agg(to_jsonb(s) - 'kind' order by start) from summary s where kind = 'day'), '[]'))
  );
end;
$$;

revoke all on function public.admin_retention(text, text, integer) from public;
grant execute on function public.admin_retention(text, text, integer) to anon, authenticated;
