-- Dirk Progression: each player's bird weights, pool and area, as one JSON document per sync code.
-- Reached only through the two functions below, like progress (sync_push / sync_pull).
-- Additive: nothing existing changes, so the main app is unaffected.
create table if not exists public.learner_profiles (
  key_hash text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.learner_profiles enable row level security;  -- no policies: functions only

create or replace function public.profile_pull(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  return (select data from public.learner_profiles where key_hash = public.sync_key_hash(p_key));
end;
$$;

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
  on conflict (key_hash) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.profile_pull(text) from public;
revoke all on function public.profile_push(text, jsonb) from public;
grant execute on function public.profile_pull(text) to anon, authenticated;
grant execute on function public.profile_push(text, jsonb) to anon, authenticated;
