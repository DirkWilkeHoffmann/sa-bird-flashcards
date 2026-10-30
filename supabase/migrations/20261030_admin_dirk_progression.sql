-- Admin page for the Dirk Progression: mastered / learning come from each player's weights
-- (learner_profiles: seen and weight 4+ = mastered) when they have them, otherwise from the old
-- streaks; players show their area and family; new-bird batches and "all mastered" are counted.
-- Only the admin functions change; nothing players use.

-- Mastered / learning birds in one learner profile. Profiles are written by players, so anything
-- that isn't the expected shape (birds an object of objects, numeric w, boolean seen) is skipped
-- rather than cast, so one bad profile can't break the admin reports.
create or replace function public.profile_counts(p_data jsonb)
returns table (mastered bigint, learning bigint)
language sql
immutable
set search_path to ''
as $$
  select count(*) filter (where (b.value->'w')::numeric >= 4),
         count(*) filter (where (b.value->'w')::numeric < 4)
  from jsonb_each(case when jsonb_typeof(p_data->'birds') = 'object' then p_data->'birds' else '{}'::jsonb end) b
  where jsonb_typeof(b.value) = 'object'
    and jsonb_typeof(b.value->'w') = 'number'
    and b.value->'seen' = 'true'::jsonb;
$$;
revoke all on function public.profile_counts(jsonb) from public, anon, authenticated;

create or replace function public.admin_players(p_key text, p_env text default 'main')
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  return coalesce((
    with acc as (
      select public.sync_key_hash(a.sync_code) key_hash, a.user_id, 'main' app from public.accounts a
      union all
      select public.sync_key_hash(a.sync_code), a.user_id, 'dev' from public.accounts_dev a
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
    left join lateral (select * from acc where acc.key_hash = p.key_hash order by app limit 1) acc on true
    left join auth.users u on u.id = acc.user_id
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_player(p_key text, p_id text, p_env text default 'main')
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  h text;
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  select key_hash into h from (
    select key_hash from public.progress union select key_hash from public.events
    union select key_hash from public.learner_profiles) k
  where key_hash like p_id || '%' limit 1;
  if h is null or length(p_id) < 6 then
    return null;
  end if;
  return jsonb_build_object(
    'birds', coalesce((select jsonb_agg(jsonb_build_object('id', species_id, 'right', right_count, 'wrong', wrong_count,
        'streak', streak, 'first', seen_at, 'updated', updated_at) order by updated_at desc)
      from public.progress where key_hash = h), '[]'),
    'weights', (select data->'birds' from public.learner_profiles where key_hash = h),
    'mixups', coalesce((select jsonb_agg(jsonb_build_object('id', species_id, 'picked', picked_id, 'n', n) order by n desc)
      from public.mixups where key_hash = h), '[]'),
    'hidden_photos', (select count(*) from public.hidden_photos where key_hash = h),
    'recent', coalesce((select jsonb_agg(x order by at desc) from (
        select type, species_id id, detail d, at from public.events
        where key_hash = h and env = p_env order by at desc limit 150) x), '[]')
  );
end;
$function$;

create or replace function public.admin_report(p_key text, p_env text default 'main', p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(1, least(p_days, 365)) - 1);
begin
  if public.admin_name(p_key) is null then
    raise exception 'not allowed';
  end if;
  return jsonb_build_object(
    'generated', now(),
    'totals', jsonb_build_object(
      'accounts', (select count(*) from auth.users),
      'accounts_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'players', (select count(*) from (select key_hash from public.progress union select key_hash from public.learner_profiles) k),
      'active_1d', (select count(distinct key_hash) from (
          select key_hash from public.progress where updated_at > now() - interval '1 day'
          union select key_hash from public.events where env = p_env and at > now() - interval '1 day') a),
      'active_7d', (select count(distinct key_hash) from (
          select key_hash from public.progress where updated_at > now() - interval '7 days'
          union select key_hash from public.events where env = p_env and at > now() - interval '7 days') a),
      'answers', (select coalesce(sum(right_count + wrong_count), 0) from public.progress),
      'mastered', (select coalesce(sum(c.mastered), 0) from public.learner_profiles l, public.profile_counts(l.data) c)
        + (select count(*) from public.progress p where streak >= 3
             and not exists (select 1 from public.learner_profiles l where l.key_hash = p.key_hash)),
      'flags_waiting', (select count(*) from public.photo_reviews where status = 'pending')),
    'signups_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (
        select date_trunc('day', created_at)::date d, count(*) n from auth.users
        where created_at >= since group by 1) s), '[]'),
    'active_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (
        select d, count(distinct key_hash) n from (
          select date_trunc('day', updated_at)::date d, key_hash from public.progress where updated_at >= since
          union select date_trunc('day', at)::date, key_hash from public.events where env = p_env and at >= since) a
        group by d) s), '[]'),
    'events_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'type', type, 'n', n) order by d, type) from (
        select date_trunc('day', at)::date d, type, count(*) n from public.events
        where env = p_env and at >= since group by 1, 2) s), '[]'),
    'event_totals', coalesce((select jsonb_object_agg(type, n) from (
        select type, count(*) n from public.events where env = p_env and at >= since group by 1) s), '{}'),
    'most_missed', coalesce((select jsonb_agg(x order by miss desc) from (
        select species_id id, sum(wrong_count) wrong, sum(right_count + wrong_count) tries,
               round(sum(wrong_count)::numeric / nullif(sum(right_count + wrong_count), 0), 2) miss
        from public.progress group by species_id having sum(right_count + wrong_count) >= 5
        order by miss desc, tries desc limit 15) x), '[]'),
    'top_mixups', coalesce((select jsonb_agg(x order by n desc) from (
        select species_id id, picked_id picked, sum(n) n, count(distinct key_hash) players
        from public.mixups group by 1, 2 order by n desc limit 15) x), '[]'),
    'photos', coalesce((select jsonb_agg(x order by reported_at desc) from (
        select photo_id, species_id, species_name, photo_url, reports, reported_at
        from public.photo_reviews where status = 'pending') x), '[]')
  );
end;
$function$;
