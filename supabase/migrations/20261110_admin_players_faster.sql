-- The dashboard's player list often failed on first load ("Couldn't load the dashboard"): finding
-- each player's account worked out every account's key again for every player (1,674 × 346), which
-- took 2–3 s and hit the 3 s limit on public requests. Now each account's key is worked out once and
-- matched with a plain join (about 0.1 s). Same result: an account on main and dev picks dev first,
-- as before ('dev' sorts before 'main'). Nothing else changes.
create or replace function public.admin_players(p_key text, p_env text default 'main')
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
    with acc as materialized (
      select distinct on (key_hash) key_hash, user_id, app from (
        select public.sync_key_hash(a.sync_code) key_hash, a.user_id, 'main' app from public.accounts a
        union all
        select public.sync_key_hash(a.sync_code), a.user_id, 'dev' from public.accounts_dev a
      ) a
      order by key_hash, app
    ),
    prog as (
      select key_hash, count(*) birds, sum(right_count) rights, sum(wrong_count) wrongs,
             count(*) filter (where streak >= 3) mastered, count(*) filter (where streak < 3) learning,
             min(seen_at) first_seen, max(updated_at) last_progress,
             count(distinct date_trunc('day', updated_at)) days_progress
      from public.progress group by key_hash
    ),
    prof as (
      select l.key_hash, c.mastered, c.learning, l.data->'settings' settings
      from public.learner_profiles l, public.profile_counts(l.data) c
    ),
    ev as (
      select key_hash, max(at) last_event, count(distinct date_trunc('day', at)) days_events,
             count(*) filter (where type = 'open') opens, count(*) filter (where type = 'hint') hints,
             count(*) filter (where type = 'skip') skips, count(*) filter (where type = 'snooze') snoozes,
             count(*) filter (where type in ('added', 'batch')) batches,
             count(*) filter (where type = 'all_mastered') all_mastered,
             count(*) filter (where type = 'call_failed') call_failed,
             (array_agg(detail order by at desc) filter (where type = 'open'))[1] last_open
      from public.events where env = p_env group by key_hash
    ),
    players as (select key_hash from prog union select key_hash from ev union select key_hash from prof)
    select jsonb_agg(jsonb_build_object(
      'id', left(p.key_hash, 10),
      'name', u.raw_user_meta_data->>'full_name',
      'email', u.email,
      'picture', u.raw_user_meta_data->>'avatar_url',
      'app', acc.app,
      'signed_up', u.created_at,
      'last_sign_in', u.last_sign_in_at,
      'first_played', pr.first_seen,
      'last_played', greatest(pr.last_progress, ev.last_event),
      'days_played', greatest(coalesce(pr.days_progress, 0), coalesce(ev.days_events, 0)),
      'birds', coalesce(pr.birds, 0), 'answers', coalesce(pr.rights + pr.wrongs, 0),
      'right', coalesce(pr.rights, 0), 'wrong', coalesce(pr.wrongs, 0),
      'mastered', coalesce(pf.mastered, pr.mastered, 0), 'learning', coalesce(pf.learning, pr.learning, 0),
      'opens', coalesce(ev.opens, 0), 'hints', coalesce(ev.hints, 0), 'skips', coalesce(ev.skips, 0),
      'snoozes', coalesce(ev.snoozes, 0), 'batches', coalesce(ev.batches, 0),
      'all_mastered', coalesce(ev.all_mastered, 0), 'call_failed', coalesce(ev.call_failed, 0),
      'area', coalesce(pf.settings->>'area', ev.last_open->>'area'),
      'family', nullif(pf.settings->>'family', ''),
      'levels', ev.last_open->>'levels')
      order by greatest(pr.last_progress, ev.last_event) desc nulls last)
    from players p
    left join prog pr on pr.key_hash = p.key_hash
    left join prof pf on pf.key_hash = p.key_hash
    left join ev on ev.key_hash = p.key_hash
    left join acc on acc.key_hash = p.key_hash
    left join auth.users u on u.id = acc.user_id
  ), '[]'::jsonb);
end;
$$;
