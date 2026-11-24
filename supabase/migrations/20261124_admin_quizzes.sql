-- Quizzes with friends, for the dashboard's Quizzes tab (admin.html). Same key check as the other
-- admin_* functions. Quizzes are per build (p_env 'main' = the live app, 'dev'); friendships and
-- quiz names are shared by both builds, so those numbers are the same whichever is picked.
--   totals      quizzes sent, played (finished), friendships made in the period; all friendships;
--               players with a quiz name; invited friends who played; invite links shared;
--               players with notifications on
--   by_day      per day: quizzes sent, quizzes played, friendships made
--   recent      the latest 30 quizzes in the period, with each player's status and score
--   friendships the latest 30 friendships made in the period (each pair once)
--   top         the 10 players who sent and played the most quizzes in the period
create or replace function public.admin_quizzes(p_key text, p_env text default 'main', p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(1, least(p_days, 365)) - 1);
  e text := case when p_env = 'dev' then 'dev' else 'main' end;
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  return (
    with rounds as (
      select * from public.quiz_rounds where env = e and created_at >= since
    ),
    entries as (
      select en.*, r.created_by from public.quiz_entries en join rounds r on r.id = en.round_id
    ),
    played as (  -- finished in the period, whenever the quiz was sent
      select en.* from public.quiz_entries en join public.quiz_rounds r on r.id = en.round_id
      where r.env = e and en.status = 'done' and en.finished_at >= since
    ),
    pairs as (   -- each friendship once
      select * from public.quiz_friends where user_id < friend_id
    ),
    days as (
      select generate_series(since::date, now()::date, interval '1 day')::date d
    )
    select jsonb_build_object(
      'totals', jsonb_build_object(
        'quizzes', (select count(*) from rounds),
        'senders', (select count(distinct created_by) from rounds),
        'plays', (select count(*) from played),
        'players_played', (select count(distinct user_id) from played),
        'avg_score', (select round(avg(score), 1) from played),
        'invited', (select count(*) from entries where user_id <> created_by),
        'invited_played', (select count(*) from entries where user_id <> created_by and status = 'done'),
        'declined', (select count(*) from entries where status = 'declined'),
        'friendships_new', (select count(*) from pairs where created_at >= since),
        'friendships', (select count(*) from pairs),
        'with_friends', (select count(distinct user_id) from public.quiz_friends),
        'quiz_players', (select count(*) from public.quiz_players),
        'invites_shared', (select count(*) from public.events
                           where env = e and type = 'quiz' and at >= since and detail->>'step' = 'invite_share'),
        'notifications', (select count(distinct user_id) from public.push_subscriptions where env = e)),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object(
          'day', d,
          'quizzes', (select count(*) from rounds where created_at::date = d),
          'plays', (select count(*) from played where finished_at::date = d),
          'friends', (select count(*) from pairs where created_at::date = d)) order by d), '[]') from days),
      'recent', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]') from (
          select jsonb_build_object(
            'at', r.created_at, 'area', r.area_name, 'level', r.level, 'open', r.closes_at > now(),
            'by', (select name from public.quiz_players where user_id = r.created_by),
            'players', (select jsonb_agg(jsonb_build_object(
                'name', p.name, 'sender', en.user_id = r.created_by, 'status', en.status, 'score', en.score)
                order by en.score desc nulls last, lower(p.name))
              from public.quiz_entries en join public.quiz_players p on p.user_id = en.user_id
              where en.round_id = r.id)) x
          from rounds r order by r.created_at desc limit 30) s),
      'friendships', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]') from (
          select jsonb_build_object('at', f.created_at,
            'a', (select name from public.quiz_players where user_id = f.user_id),
            'b', (select name from public.quiz_players where user_id = f.friend_id)) x
          from pairs f where f.created_at >= since order by f.created_at desc limit 30) s),
      'top', (select coalesce(jsonb_agg(x order by (x->>'sent')::int + (x->>'played')::int desc), '[]') from (
          select jsonb_build_object('name', qp.name,
            'sent', (select count(*) from rounds where created_by = qp.user_id),
            'played', (select count(*) from played where user_id = qp.user_id),
            'avg', (select round(avg(score), 1) from played where user_id = qp.user_id)) x
          from public.quiz_players qp
          where exists (select 1 from rounds where created_by = qp.user_id)
             or exists (select 1 from played where user_id = qp.user_id)
          order by (select count(*) from rounds where created_by = qp.user_id)
                 + (select count(*) from played where user_id = qp.user_id) desc
          limit 10) s),
      'generated', now()));
end;
$$;

-- Like the other admin_* functions, callable with the public key; the private key check is inside.
grant execute on function public.admin_quizzes(text, text, integer) to anon, authenticated;
