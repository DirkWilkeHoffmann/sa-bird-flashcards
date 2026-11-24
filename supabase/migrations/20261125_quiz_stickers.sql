-- Quiz stickers (Dev, 25 Nov 2026): three stickers earned only in quizzes with friends, never drawn
-- as a day's sticker. Each is earned once per build (Dev or the main app), like the quizzes:
--   played_1   finish your first quiz
--   played_10  finish 10 quizzes
--   won_50     win 50 quizzes
-- A win: a quiz that's over (closed, or everyone has played or said no thanks) where at least one
-- other player finished and nobody did better than you (more Right, or as many in less time; the
-- order the results show). Which bird each one is lives in the app (stickers.js), so a bird can be
-- swapped without touching this.
-- Row-level security is on with no policies: only quiz_awards() below reads or writes the table.

create table if not exists public.quiz_awards (
  user_id uuid not null references auth.users on delete cascade,
  env text not null check (env in ('main', 'dev')),
  award text not null check (award in ('played_1', 'played_10', 'won_50')),
  earned_at timestamptz not null default now(),
  primary key (user_id, env, award)
);
alter table public.quiz_awards enable row level security;

-- My quizzes finished and won on this build, and my quiz stickers. Any sticker reached since the
-- last call is saved now and comes back with fresh = true (the app shows it the big way, once).
create or replace function public.quiz_awards(p_env text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  e text := case when p_env = 'dev' then 'dev' else 'main' end;
  played integer;
  won integer;
  fresh text[];
begin
  if me is null then raise exception 'not signed in'; end if;
  select count(*) into played
  from public.quiz_entries en join public.quiz_rounds r on r.id = en.round_id
  where en.user_id = me and en.status = 'done' and r.env = e;
  select count(*) into won
  from public.quiz_entries en join public.quiz_rounds r on r.id = en.round_id
  where en.user_id = me and en.status = 'done' and r.env = e
    and (r.closes_at <= now() or not exists (
      select 1 from public.quiz_entries o where o.round_id = r.id and o.status in ('invited', 'playing')))
    and exists (
      select 1 from public.quiz_entries o where o.round_id = r.id and o.user_id <> me and o.status = 'done')
    and not exists (
      select 1 from public.quiz_entries o where o.round_id = r.id and o.user_id <> me and o.status = 'done'
        and (o.score > en.score or (o.score = en.score and o.time_ms < en.time_ms)));
  with ins as (
    insert into public.quiz_awards (user_id, env, award)
    select me, e, a from (values ('played_1', played >= 1), ('played_10', played >= 10), ('won_50', won >= 50)) v(a, ok)
    where ok
    on conflict do nothing
    returning award
  ) select array_agg(award) into fresh from ins;
  return jsonb_build_object('played', played, 'won', won,
    'awards', (select coalesce(jsonb_agg(jsonb_build_object(
        'award', award, 'at', earned_at, 'fresh', award = any(coalesce(fresh, '{}'))) order by earned_at), '[]')
      from public.quiz_awards where user_id = me and env = e));
end $$;
revoke execute on function public.quiz_awards(text) from public, anon;
grant execute on function public.quiz_awards(text) to authenticated;
