-- Stickers for the dashboard (applied 6 Nov 2026): every sticker every player has, with the day it
-- was earned. Read from the synced profiles (days[day].k = the sticker's bird id), which hold the whole
-- history, including stickers earned before the 'sticker' event was allowed on 5 Nov.
-- Players are shown with the same short id as admin_players, so the two can be joined in the page.
create or replace function public.admin_stickers(p_key text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  return coalesce((
    with acc as (
      select public.sync_key_hash(a.sync_code) key_hash, a.user_id, 'main' app from public.accounts a
      union all
      select public.sync_key_hash(a.sync_code), a.user_id, 'dev' from public.accounts_dev a
    )
    select jsonb_agg(jsonb_build_object(
      'player', left(l.key_hash, 10),
      'day', d.key,
      -- the filter below has already checked k is a short number; the case keeps the cast safe whatever order Postgres runs things in
      'id', case when d.value->>'k' ~ '^\d{1,7}$' then (d.value->>'k')::int end,
      'app', acc.app)
      order by d.key desc, l.key_hash)
    from public.learner_profiles l
    cross join lateral jsonb_each(case when jsonb_typeof(l.data->'days') = 'object' then l.data->'days' else '{}'::jsonb end) d
    left join lateral (select * from acc where acc.key_hash = l.key_hash order by app limit 1) acc on true
    -- Synced data comes from players' phones, so only well-formed days and sticker ids are read.
    where d.key ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(d.value) = 'object' and d.value->>'k' ~ '^\d{1,7}$'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_stickers(text) from public;
grant execute on function public.admin_stickers(text) to anon, authenticated;
