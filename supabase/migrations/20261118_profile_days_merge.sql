-- Streak and stickers are never lost when profiles are saved (18 Nov 2026).
-- profile_push used to replace the whole profile with what the phone sent. A phone that hadn't read
-- the account's days yet (a new phone signing in, whose first sync read its own empty profile and
-- then wrote under the account's code) replaced every streak day and sticker with its own few.
-- Now the days are combined on the server: for each day the highest answers, Rights and mastered
-- count from either side, and the day's sticker that was there first stays. Within the limits below,
-- no phone can remove a day.
-- Limits, so a profile can't grow without end: only dates from 2026 up to two days ahead are
-- kept, at most the newest 400 (as on the phone, streak.js KEEP_DAYS); counts are whole numbers from
-- 0 to 100000; a sticker is a positive bird id; and the combined profile must stay under 400000
-- characters, like what a phone may send.
-- Everything else in the profile (weights, area, names, …) is still sent whole, as before.

create or replace function public.merge_days(p_old jsonb, p_new jsonb)
returns jsonb
language sql
stable
set search_path to ''
as $$
  with o as (select case when jsonb_typeof(p_old) = 'object' then p_old else '{}'::jsonb end j),
       n as (select case when jsonb_typeof(p_new) = 'object' then p_new else '{}'::jsonb end j),
       keys as (
         select k from o, jsonb_object_keys(o.j) k
         union
         select k from n, jsonb_object_keys(n.j) k),
       valid as (
         select k from keys
         where k ~ '^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'  -- a date (checked without failing)
           and k >= '2026-01-01'
           and k <= pg_catalog.to_char(current_date + 2, 'YYYY-MM-DD')
         order by k desc
         limit 400),
       pairs as (
         select k,
                case when jsonb_typeof(o.j -> k) = 'object' then o.j -> k else '{}'::jsonb end od,
                case when jsonb_typeof(n.j -> k) = 'object' then n.j -> k else '{}'::jsonb end nd
         from valid, o, n),
       num as (
         select k, od, nd,
                (select least(greatest(coalesce(max(x), 0), 0), 100000)::int
                   from (select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end x
                         from unnest(array[od -> 'a', nd -> 'a']) v) t) a,
                (select least(greatest(coalesce(max(x), 0), 0), 100000)::int
                   from (select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end x
                         from unnest(array[od -> 'r', nd -> 'r']) v) t) r,
                (select least(greatest(coalesce(max(x), 0), 0), 100000)::int
                   from (select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end x
                         from unnest(array[od -> 'm', nd -> 'm']) v) t) m
         from pairs)
  select coalesce(jsonb_object_agg(k, jsonb_strip_nulls(jsonb_build_object(
           'a', a, 'r', r, 'm', m,
           'k', coalesce(case when jsonb_typeof(od -> 'k') = 'number' and (od ->> 'k') ~ '^[1-9]\d{0,8}$' then od -> 'k' end,
                         case when jsonb_typeof(nd -> 'k') = 'number' and (nd ->> 'k') ~ '^[1-9]\d{0,8}$' then nd -> 'k' end)))), '{}'::jsonb)
  from num;
$$;

revoke all on function public.merge_days(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.profile_push(p_key text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  merged jsonb;
begin
  if length(p_data::text) > 400000 then
    raise exception 'too much data';
  end if;
  select p_data || jsonb_build_object('days', public.merge_days(lp.data -> 'days', p_data -> 'days'))
    into merged
    from public.learner_profiles lp
   where lp.key_hash = public.sync_key_hash(p_key)
     for update;
  if merged is null then  -- a new profile: its days are checked the same way
    merged := p_data || jsonb_build_object('days', public.merge_days(null, p_data -> 'days'));
  end if;
  if length(merged::text) > 400000 then
    raise exception 'too much data';
  end if;
  insert into public.learner_profiles (key_hash, data, updated_at)
  values (public.sync_key_hash(p_key), merged, now())
  on conflict (key_hash) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.profile_push(text, jsonb) from public;
grant execute on function public.profile_push(text, jsonb) to anon, authenticated;
