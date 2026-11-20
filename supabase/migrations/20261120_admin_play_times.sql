-- When do players play? For the dashboard's overview. Over the chosen period, in South African time:
--   hours     one row per hour of the day (0–23):
--               plays    player-days with any play in that hour (a player who plays at 7pm on 5 days counts 5)
--               players  different players who ever played in that hour
--               answers  answers given in that hour
--   weekdays  one row per day of the week (1 = Monday … 7 = Sunday), same counts.
-- Any event counts as playing. Built from usage events (kept for 100 days), so at most 90 days.
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
    )
    select jsonb_build_object(
      'hours', coalesce((select jsonb_agg(to_jsonb(h) order by hour) from hours h), '[]'),
      'weekdays', coalesce((select jsonb_agg(to_jsonb(w) order by dow) from weekdays w), '[]'))
  );
end;
$$;

revoke all on function public.admin_play_times(text, text, integer) from public;
grant execute on function public.admin_play_times(text, text, integer) to anon, authenticated;
