-- Streak and stickers are never lost when profiles are saved (18 Nov 2026).
-- profile_push used to replace the whole profile with what the phone sent. A phone that hadn't read
-- the account's days yet (a new phone signing in, whose first sync read its own empty profile and
-- then wrote under the account's code) replaced every streak day and sticker with its own few.
-- Now the days are combined on the server: for each day the highest answers, Rights and mastered
-- count from either side, and the day's sticker that was there first stays. Nothing can remove a day.
-- Everything else in the profile (weights, area, names, …) is still sent whole, as before.

create or replace function public.merge_days(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path to ''
as $$
  with o as (select case when jsonb_typeof(p_old) = 'object' then p_old else '{}'::jsonb end j),
       n as (select case when jsonb_typeof(p_new) = 'object' then p_new else '{}'::jsonb end j),
       keys as (
         select k from o, jsonb_object_keys(o.j) k
         union
         select k from n, jsonb_object_keys(n.j) k),
       pairs as (
         select k,
                case when jsonb_typeof(o.j -> k) = 'object' then o.j -> k else '{}'::jsonb end od,
                case when jsonb_typeof(n.j -> k) = 'object' then n.j -> k else '{}'::jsonb end nd
         from keys, o, n
         where k ~ '^\d{4}-\d{2}-\d{2}$')
  select coalesce(jsonb_object_agg(k, jsonb_strip_nulls(jsonb_build_object(
           'a', greatest(case when jsonb_typeof(od -> 'a') = 'number' then (od ->> 'a')::numeric else 0 end,
                         case when jsonb_typeof(nd -> 'a') = 'number' then (nd ->> 'a')::numeric else 0 end),
           'r', greatest(case when jsonb_typeof(od -> 'r') = 'number' then (od ->> 'r')::numeric else 0 end,
                         case when jsonb_typeof(nd -> 'r') = 'number' then (nd ->> 'r')::numeric else 0 end),
           'm', greatest(case when jsonb_typeof(od -> 'm') = 'number' then (od ->> 'm')::numeric else 0 end,
                         case when jsonb_typeof(nd -> 'm') = 'number' then (nd ->> 'm')::numeric else 0 end),
           'k', coalesce(case when jsonb_typeof(od -> 'k') = 'number' then od -> 'k' end,
                         case when jsonb_typeof(nd -> 'k') = 'number' then nd -> 'k' end)))), '{}'::jsonb)
  from pairs;
$$;

revoke all on function public.merge_days(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.profile_push(p_key text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if length(p_data::text) > 400000 then
    raise exception 'too much data';
  end if;
  insert into public.learner_profiles (key_hash, data, updated_at)
  values (public.sync_key_hash(p_key), p_data, now())
  on conflict (key_hash) do update
    set data = excluded.data || jsonb_build_object('days',
                 public.merge_days(public.learner_profiles.data -> 'days', excluded.data -> 'days')),
        updated_at = now();
end;
$$;

revoke all on function public.profile_push(text, jsonb) from public;
grant execute on function public.profile_push(text, jsonb) to anon, authenticated;
