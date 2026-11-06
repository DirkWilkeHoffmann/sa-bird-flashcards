-- Where players come from, for the dashboard. The app adds 'from' (a shared link's ?from=…) and
-- 'ref' (the site the link was tapped on) to its 'open' event. For each source this gives:
--   new       players whose first visit was in the period and came from it
--   back      of those, how many played again on a later day
--   week      of those, how many still played 7 or more days after their first visit
--   visitors  everyone (new or not) who opened the app from it in the period
-- A source is the ?from= name, else 'site:' plus the site, else '' (no link, or before 6 Nov 2026).
-- Events are kept for 100 days, so a player back after more than 100 days away counts as new.
create or replace function public.admin_sources(p_key text, p_env text default 'main', p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(1, least(p_days, 365)) - 1);
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  return coalesce((
    with opens as (
      select key_hash, at,
             coalesce(left(detail->>'from', 40), 'site:' || left(detail->>'ref', 60)) src
      from public.events
      where env = p_env and type = 'open' and at >= since
        and jsonb_typeof(detail) = 'object' and (detail ? 'from' or detail ? 'ref')
    ),
    players as (
      select key_hash, min(at) first_at, max(at) last_at
      from public.events where env = p_env
      group by key_hash
      having min(at) >= since
    ),
    first_src as (
      -- the first source seen on the player's first day
      select distinct on (p.key_hash) p.key_hash, o.src
      from players p join opens o on o.key_hash = p.key_hash and o.at < p.first_at + interval '1 day'
      order by p.key_hash, o.at
    ),
    new_by as (
      select coalesce(f.src, '') src, count(*) new,
             count(*) filter (where p.last_at::date > p.first_at::date) back,
             count(*) filter (where p.last_at >= p.first_at + interval '7 days') week
      from players p left join first_src f using (key_hash)
      group by 1
    ),
    visit_by as (
      select src, count(distinct key_hash) visitors from opens group by 1
    )
    select jsonb_agg(jsonb_build_object(
      'src', coalesce(n.src, v.src),
      'new', coalesce(n.new, 0), 'back', coalesce(n.back, 0), 'week', coalesce(n.week, 0),
      'visitors', coalesce(v.visitors, 0))
      order by coalesce(n.new, 0) desc, coalesce(v.visitors, 0) desc)
    from new_by n full join visit_by v on v.src = n.src
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_sources(text, text, integer) from public;
grant execute on function public.admin_sources(text, text, integer) to anon, authenticated;
