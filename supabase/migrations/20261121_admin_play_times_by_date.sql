-- When do players play, day by day? Adds to admin_play_times (20261120), so the dashboard can show the hours of
-- one calendar day at a time and averages aren't hidden behind one busy day. Same as before, plus:
--   dates  one row per calendar day in the period (South African time) with any play:
--            day      the date
--            players  different players who played that day
--            answers  answers given that day
--            hours    one row per hour with any play that day: hour, players, answers
create or replace function public.admin_play_times(p_key text, p_env text default 'main', p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(1, least(p_days, 90)) - 1);
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  return (
    with e as (
      select key_hash, type, at at time zone 'Africa/Johannesburg' t
      from public.events where env = p_env and at >= since
    ),
    hours as (
      select extract(hour from t)::int as hour,
             count(distinct (key_hash, t::date)) as plays,
             count(distinct key_hash) as players,
             count(*) filter (where type = 'answer') as answers
      from e group by 1
    ),
    weekdays as (
      select extract(isodow from t)::int as dow,
             count(distinct (key_hash, t::date)) as plays,
             count(distinct key_hash) as players,
             count(*) filter (where type = 'answer') as answers
      from e group by 1
    ),
    date_hours as (
      select t::date as day, extract(hour from t)::int as hour,
             count(distinct key_hash) as players,
             count(*) filter (where type = 'answer') as answers
      from e group by 1, 2
    ),
    dates as (
      select t::date as day, count(distinct key_hash) as players,
             count(*) filter (where type = 'answer') as answers
      from e group by 1
    )
    select jsonb_build_object(
      'hours', coalesce((select jsonb_agg(to_jsonb(h) order by hour) from hours h), '[]'),
      'weekdays', coalesce((select jsonb_agg(to_jsonb(w) order by dow) from weekdays w), '[]'),
      'dates', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'players', d.players, 'answers', d.answers,
          'hours', (select jsonb_agg(jsonb_build_object('hour', x.hour, 'players', x.players, 'answers', x.answers) order by x.hour)
                    from date_hours x where x.day = d.day)) order by d.day) from dates d), '[]'))
  );
end;
$$;

revoke all on function public.admin_play_times(text, text, integer) from public;
grant execute on function public.admin_play_times(text, text, integer) to anon, authenticated;
