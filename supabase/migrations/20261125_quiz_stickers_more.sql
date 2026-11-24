-- Three more quiz stickers (Dev, 25 Nov 2026), on top of 20261125_quiz_stickers.sql:
--   won_hard_20  win 20 quizzes on Hard
--   won_easy_10  win 10 quizzes on Easy
--   perfect_1    get all 10 right in a quiz
-- A win is as before: a quiz that's over, where at least one other player finished and nobody did better.

alter table public.quiz_awards drop constraint if exists quiz_awards_award_check;
alter table public.quiz_awards add constraint quiz_awards_award_check
  check (award in ('played_1', 'played_10', 'won_50', 'won_hard_20', 'won_easy_10', 'perfect_1'));

create or replace function public.quiz_awards(p_env text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  e text := case when p_env = 'dev' then 'dev' else 'main' end;
  played integer;
  perfect integer;
  won integer;
  won_hard integer;
  won_easy integer;
  fresh text[];
begin
  if me is null then raise exception 'not signed in'; end if;
  select count(*), count(*) filter (where en.score >= 10) into played, perfect
  from public.quiz_entries en join public.quiz_rounds r on r.id = en.round_id
  where en.user_id = me and en.status = 'done' and r.env = e;
  select count(*), count(*) filter (where r.level = 'hard'), count(*) filter (where r.level = 'easy')
  into won, won_hard, won_easy
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
    select me, e, a from (values
      ('played_1', played >= 1), ('played_10', played >= 10), ('won_50', won >= 50),
      ('won_hard_20', won_hard >= 20), ('won_easy_10', won_easy >= 10), ('perfect_1', perfect >= 1)) v(a, ok)
    where ok
    on conflict do nothing
    returning award
  ) select array_agg(award) into fresh from ins;
  return jsonb_build_object('played', played, 'won', won, 'won_hard', won_hard, 'won_easy', won_easy,
    'perfect', perfect,
    'awards', (select coalesce(jsonb_agg(jsonb_build_object(
        'award', award, 'at', earned_at, 'fresh', award = any(coalesce(fresh, '{}'))) order by earned_at), '[]')
      from public.quiz_awards where user_id = me and env = e));
end $$;
revoke execute on function public.quiz_awards(text) from public, anon;
grant execute on function public.quiz_awards(text) to authenticated;
