-- admin_play_times, faster: on the live app it took over 4 seconds (it read every event once per day for the
-- day-by-day hours), past the 3-second limit on dashboard calls, so the Live app's charts never showed.
-- Events are now grouped once into one row per player, day and hour, and every count is made from those
-- (0.4 s for 90 days of ~140,000 events). Same answer as 20261121.
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
    with g as (  -- one row per player, day and hour played (South African time)
      select key_hash, (at at time zone 'Africa/Johannesburg')::date as day,
             extract(hour from at at time zone 'Africa/Johannesburg')::int as hour,
             count(*) filter (where type = 'answer') as answers
      from public.events where env = p_env and at >= since
      group by 1, 2, 3
    ),
    pd as (select key_hash, day, sum(answers) as answers from g group by 1, 2),  -- one row per player and day
    hours as (
      select hour, count(*) as plays, count(distinct key_hash) as players, sum(answers)::int as answers
      from g group by 1
    ),
    weekdays as (
      select extract(isodow from day)::int as dow, count(*) as plays, count(distinct key_hash) as players,
             sum(answers)::int as answers
      from pd group by 1
    ),
    date_hours as (
      select day, jsonb_agg(jsonb_build_object('hour', hour, 'players', players, 'answers', answers) order by hour) as hours
      from (select day, hour, count(*) as players, sum(answers)::int as answers from g group by 1, 2) x
      group by 1
    ),
    dates as (select day, count(*) as players, sum(answers)::int as answers from pd group by 1)
    select jsonb_build_object(
      'hours', coalesce((select jsonb_agg(to_jsonb(h) order by hour) from hours h), '[]'),
      'weekdays', coalesce((select jsonb_agg(to_jsonb(w) order by dow) from weekdays w), '[]'),
      'dates', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'players', d.players, 'answers', d.answers,
          'hours', dh.hours) order by d.day) from dates d join date_hours dh using (day)), '[]'))
  );
end;
$$;

revoke all on function public.admin_play_times(text, text, integer) from public;
grant execute on function public.admin_play_times(text, text, integer) to anon, authenticated;
