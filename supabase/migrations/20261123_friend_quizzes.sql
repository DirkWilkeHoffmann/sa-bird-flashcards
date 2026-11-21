-- Friend quizzes (Dev, 21 Nov 2026): friends by friend code, rounds of 10 birds open for 24 hours,
-- and web-push subscriptions. See docs/plan-friend-quizzes.md.
-- Row-level security is on with no policies: nothing reads these tables directly. Every function
-- below works only for the signed-in user (auth.uid()), and only shows what that user may see.

create table if not exists public.quiz_players (
  user_id uuid primary key references auth.users on delete cascade,
  friend_code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- Stored both ways (a → b and b → a), so "my friends" is one lookup.
create table if not exists public.quiz_friends (
  user_id uuid not null references auth.users on delete cascade,
  friend_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

create table if not exists public.quiz_rounds (
  id uuid primary key default gen_random_uuid(),
  env text not null check (env in ('main', 'dev')),
  created_by uuid not null references auth.users on delete cascade,
  area text not null,
  area_name text not null,
  level text not null check (level in ('beginner', 'easy', 'medium', 'hard')),
  birds jsonb not null,  -- [{ "id": species id, "photo": the photo everyone starts on }] × 10
  created_at timestamptz not null default now(),
  closes_at timestamptz not null default now() + interval '24 hours',
  results_sent boolean not null default false  -- "everyone's played" went out
);
create index if not exists quiz_rounds_created_by on public.quiz_rounds (created_by);

create table if not exists public.quiz_entries (
  round_id uuid not null references public.quiz_rounds on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'playing', 'declined', 'done')),
  answers jsonb not null default '[]',  -- [{ "ok": bool, "ms": time taken, "typed": what they typed }], in bird order
  score integer,
  time_ms integer,
  started_at timestamptz,
  finished_at timestamptz,
  primary key (round_id, user_id)
);
create index if not exists quiz_entries_user on public.quiz_entries (user_id);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  env text not null check (env in ('main', 'dev')),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

-- The VAPID keys for web push; read only by the quiz-push Edge Function (service role).
create table if not exists public.push_config (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  subject text not null
);

alter table public.quiz_players enable row level security;
alter table public.quiz_friends enable row level security;
alter table public.quiz_rounds enable row level security;
alter table public.quiz_entries enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_config enable row level security;

-- ---------- Players and friends ----------

create or replace function public.quiz_tidy_name(p_name text)
returns text language sql immutable set search_path = '' as $$
  select left(nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ''), 30)
$$;

-- A new friend code: up to 4 letters of the name and 4 digits, e.g. DIRK-4821.
create or replace function public.quiz_make_code(p_name text)
returns text language plpgsql volatile set search_path = '' as $$
declare
  stem text := left(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g')), 4);
  code text;
begin
  if length(stem) < 2 then stem := 'BIRD'; end if;
  loop
    code := stem || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.quiz_players where friend_code = code);
  end loop;
  return code;
end $$;

-- Me: creates my quiz profile the first time (with the name the app suggests), then returns it.
create or replace function public.quiz_me(p_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  nm text := coalesce(public.quiz_tidy_name(p_name), 'Birder');
  pl public.quiz_players;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into pl from public.quiz_players where user_id = me;
  if not found then
    insert into public.quiz_players (user_id, friend_code, name)
    values (me, public.quiz_make_code(nm), nm)
    on conflict (user_id) do nothing;
    select * into pl from public.quiz_players where user_id = me;
  end if;
  return jsonb_build_object('code', pl.friend_code, 'name', pl.name);
end $$;

create or replace function public.quiz_set_name(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare nm text := public.quiz_tidy_name(p_name);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if nm is null then raise exception 'empty name'; end if;
  update public.quiz_players set name = nm where user_id = auth.uid();
  return public.quiz_me();
end $$;

-- A fresh code (the old one stops working; existing friends stay friends).
create or replace function public.quiz_new_code()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.quiz_players set friend_code = public.quiz_make_code(name) where user_id = auth.uid();
  return public.quiz_me();
end $$;

create or replace function public.quiz_add_friend(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them public.quiz_players;
  tidy text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if me is null then raise exception 'not signed in'; end if;
  -- "DIRK4821" works as well as "DIRK-4821"
  if tidy !~ '-' and tidy ~ '^[A-Z]+[0-9]{4}$' then tidy := regexp_replace(tidy, '([0-9]{4})$', '-\1'); end if;
  select * into them from public.quiz_players where friend_code = tidy;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if them.user_id = me then return jsonb_build_object('error', 'self'); end if;
  insert into public.quiz_friends (user_id, friend_id) values (me, them.user_id), (them.user_id, me)
  on conflict do nothing;
  return jsonb_build_object('id', them.user_id, 'name', them.name);
end $$;

create or replace function public.quiz_remove_friend(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.quiz_friends
  where (user_id = auth.uid() and friend_id = p_id) or (user_id = p_id and friend_id = auth.uid());
$$;

create or replace function public.quiz_friends()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.user_id, 'name', p.name) order by lower(p.name)), '[]')
  from public.quiz_friends f join public.quiz_players p on p.user_id = f.friend_id
  where f.user_id = auth.uid();
$$;

-- ---------- Rounds ----------

create or replace function public.quiz_create(p_env text, p_area text, p_area_name text, p_level text,
                                              p_birds jsonb, p_invite uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  rid uuid;
  invite uuid[] := array(select distinct x from unnest(coalesce(p_invite, '{}')) x where x <> me);
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.quiz_players where user_id = me) then raise exception 'no quiz profile'; end if;
  if jsonb_typeof(p_birds) <> 'array' or jsonb_array_length(p_birds) <> 10 then raise exception 'need 10 birds'; end if;
  if cardinality(invite) < 1 or cardinality(invite) > 9 then raise exception 'invite 1 to 9 friends'; end if;
  if exists (select 1 from unnest(invite) x
             where not exists (select 1 from public.quiz_friends f where f.user_id = me and f.friend_id = x)) then
    raise exception 'can only invite friends';
  end if;
  -- at most 30 new rounds a day each, so nobody can flood their friends
  if (select count(*) from public.quiz_rounds where created_by = me and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many quizzes today';
  end if;
  insert into public.quiz_rounds (env, created_by, area, area_name, level, birds)
  values (case when p_env = 'dev' then 'dev' else 'main' end, me, left(p_area, 40), left(p_area_name, 60), p_level,
          (select jsonb_agg(jsonb_build_object('id', (b->>'id')::int, 'photo', (b->>'photo')::bigint))
           from jsonb_array_elements(p_birds) b))
  returning id into rid;
  insert into public.quiz_entries (round_id, user_id)
  select rid, x from unnest(array_append(invite, me)) x;
  return rid;
end $$;

-- One round as I may see it. Others' scores and answers only once I've played (or it has closed).
create or replace function public.quiz_round_view(p_round uuid, p_me uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with r as (select * from public.quiz_rounds where id = p_round),
       mine as (select * from public.quiz_entries where round_id = p_round and user_id = p_me),
       open_ as (select (select closes_at from r) > now() as v),
       may_see as (select (select status from mine) = 'done' or not (select v from open_) as v)
  select jsonb_build_object(
    'id', r.id, 'env', r.env, 'area', r.area, 'area_name', r.area_name, 'level', r.level,
    'created_at', r.created_at, 'closes_at', r.closes_at, 'open', (select v from open_),
    'by', (select name from public.quiz_players where user_id = r.created_by),
    'mine', r.created_by = p_me,
    'my_status', (select status from mine),
    'my_answers', (select answers from mine),
    'birds', case when (select status from mine) in ('playing', 'done') or not (select v from open_)
                  then r.birds end,
    'players', (select jsonb_agg(jsonb_build_object(
        'name', p.name, 'me', e.user_id = p_me, 'status', e.status,
        'score', case when (select v from may_see) or e.user_id = p_me then e.score end,
        'time_ms', case when (select v from may_see) or e.user_id = p_me then e.time_ms end,
        'answered', jsonb_array_length(e.answers),
        'answers', case when (select v from may_see) or e.user_id = p_me
                        then (select jsonb_agg(a->'ok') from jsonb_array_elements(e.answers) a) end)
      order by e.score desc nulls last, e.time_ms nulls last, lower(p.name))
      from public.quiz_entries e join public.quiz_players p on p.user_id = e.user_id
      where e.round_id = r.id))
  from r where exists (select 1 from mine);
$$;
revoke execute on function public.quiz_round_view(uuid, uuid) from public, anon, authenticated;

create or replace function public.quiz_round(p_round uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.quiz_round_view(p_round, auth.uid());
$$;

-- My rounds on this build (Dev or the main app), newest first: the last 60 days.
create or replace function public.quiz_list(p_env text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.quiz_round_view(r.id, auth.uid()) order by r.created_at desc), '[]')
  from public.quiz_rounds r join public.quiz_entries e on e.round_id = r.id and e.user_id = auth.uid()
  where r.env = (case when p_env = 'dev' then 'dev' else 'main' end) and r.created_at > now() - interval '60 days';
$$;

-- Start (or carry on with) my round: returns the round with its birds.
create or replace function public.quiz_start(p_round uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.quiz_entries e set status = 'playing', started_at = coalesce(started_at, now())
  from public.quiz_rounds r
  where e.round_id = p_round and e.user_id = auth.uid() and r.id = e.round_id
    and e.status in ('invited', 'playing') and r.closes_at > now();
  return public.quiz_round(p_round);
end $$;

create or replace function public.quiz_decline(p_round uuid)
returns void language sql security definer set search_path = '' as $$
  update public.quiz_entries set status = 'declined'
  where round_id = p_round and user_id = auth.uid() and status = 'invited';
$$;

-- One answer, for the next bird in order. With the tenth, the round is done for me.
-- Returns { done, everyone } (everyone: every invited player has played or declined).
create or replace function public.quiz_answer(p_round uuid, p_index integer, p_ok boolean, p_ms integer, p_typed text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.quiz_entries;
  n integer;
begin
  select * into e from public.quiz_entries where round_id = p_round and user_id = auth.uid() for update;
  if not found or e.status <> 'playing' then raise exception 'not playing'; end if;
  -- a few minutes' grace for a round started just before it closed
  if (select closes_at + interval '15 minutes' from public.quiz_rounds where id = p_round) < now() then
    raise exception 'closed';
  end if;
  n := jsonb_array_length(e.answers);
  if p_index = n then  -- the same answer sent twice (a retry) is ignored
    e.answers := e.answers || jsonb_build_array(jsonb_build_object(
      'ok', coalesce(p_ok, false), 'ms', least(greatest(coalesce(p_ms, 60000), 0), 60000), 'typed', left(coalesce(p_typed, ''), 60)));
    n := n + 1;
  end if;
  if n >= 10 then
    update public.quiz_entries set answers = e.answers, status = 'done', finished_at = now(),
      score = (select count(*) from jsonb_array_elements(e.answers) a where (a->>'ok')::boolean),
      time_ms = (select sum((a->>'ms')::int) from jsonb_array_elements(e.answers) a)
    where round_id = p_round and user_id = auth.uid();
  else
    update public.quiz_entries set answers = e.answers where round_id = p_round and user_id = auth.uid();
  end if;
  return jsonb_build_object('done', n >= 10,
    'everyone', not exists (select 1 from public.quiz_entries where round_id = p_round and status in ('invited', 'playing')));
end $$;

-- ---------- Notifications ----------

create or replace function public.push_subscribe(p_env text, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_endpoint !~ '^https://' then raise exception 'bad endpoint'; end if;
  insert into public.push_subscriptions (endpoint, user_id, env, p256dh, auth)
  values (left(p_endpoint, 1000), auth.uid(), case when p_env = 'dev' then 'dev' else 'main' end, left(p_p256dh, 200), left(p_auth, 100))
  on conflict (endpoint) do update set user_id = excluded.user_id, env = excluded.env,
    p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'quiz_me(text)', 'quiz_set_name(text)', 'quiz_new_code()', 'quiz_add_friend(text)', 'quiz_remove_friend(uuid)',
    'quiz_friends()', 'quiz_create(text, text, text, text, jsonb, uuid[])', 'quiz_round(uuid)', 'quiz_list(text)',
    'quiz_start(uuid)', 'quiz_decline(uuid)', 'quiz_answer(uuid, integer, boolean, integer, text)',
    'push_subscribe(text, text, text, text)', 'push_unsubscribe(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

revoke execute on function public.quiz_make_code(text) from public, anon, authenticated;

-- The app logs 'quiz' usage events ({ step: friend | new | play | done | push }).
CREATE OR REPLACE FUNCTION public.log_events(p_key text, p_env text, p_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  h text := public.sync_key_hash(p_key);
begin
  if jsonb_array_length(coalesce(p_events, '[]')) > 500 then
    raise exception 'too many events';
  end if;
  insert into public.events (key_hash, env, type, species_id, detail, at)
  select h,
         case when p_env in ('main', 'dev', 'tips') then p_env else 'main' end,
         left(x->>'t', 30),
         nullif(x->>'id', '')::int,
         case when jsonb_typeof(x->'d') = 'object' and length((x->'d')::text) < 500 then x->'d' end,
         -- the phone's clock, kept within a sensible window
         least(greatest(coalesce((x->>'at')::timestamptz, now()), now() - interval '30 days'), now())
  from jsonb_array_elements(coalesce(p_events, '[]')) x
  where x->>'t' in ('open', 'answer', 'hint', 'skip', 'undo_skip', 'snooze', 'batch', 'level_up',
                    'sign_in', 'sign_out', 'call_failed', 'flag_photo', 'compare', 'offline_download',
                    'names', 'name_report', 'install_nudge', 'install_prompt', 'app_installed',
                    -- Dirk Progression, bird lists and the walkthrough (Dev, 29-30 Oct)
                    'added', 'mastered', 'all_mastered', 'area', 'family', 'bird_list', 'bird_info',
                    'onboard', 'installed', 'install_reminder',
                    -- daily goal and streak
                    'daily_goal',
                    -- stickers
                    'sticker', 'sticker_share',
                    -- friend quizzes (21 Nov)
                    'quiz');
end;
$function$;

-- The invite notification goes out once per round (quiz-push sets this).
alter table public.quiz_rounds add column if not exists invite_sent boolean not null default false;

-- After the security review (21 Nov): at most 20 wrong friend codes an hour per player, and push
-- subscriptions only for the browsers' own push services. quiz_add_friend and push_subscribe were
-- replaced with these versions (applied to Supabase as migration quiz_code_limit_push_hosts).
create table if not exists public.quiz_code_tries (
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now()
);
create index if not exists quiz_code_tries_user on public.quiz_code_tries (user_id, at);
alter table public.quiz_code_tries enable row level security;

create or replace function public.quiz_add_friend(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them public.quiz_players;
  tidy text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if me is null then raise exception 'not signed in'; end if;
  if (select count(*) from public.quiz_code_tries where user_id = me and at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('error', 'too_many');
  end if;
  if tidy !~ '-' and tidy ~ '^[A-Z]+[0-9]{4}$' then tidy := regexp_replace(tidy, '([0-9]{4})$', '-\1'); end if;
  select * into them from public.quiz_players where friend_code = tidy;
  if not found then
    insert into public.quiz_code_tries (user_id) values (me);
    delete from public.quiz_code_tries where at < now() - interval '1 day';
    return jsonb_build_object('error', 'not_found');
  end if;
  if them.user_id = me then return jsonb_build_object('error', 'self'); end if;
  insert into public.quiz_friends (user_id, friend_id) values (me, them.user_id), (them.user_id, me)
  on conflict do nothing;
  return jsonb_build_object('id', them.user_id, 'name', them.name);
end $$;

create or replace function public.push_subscribe(p_env text, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception 'bad endpoint';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, env, p256dh, auth)
  values (left(p_endpoint, 1000), auth.uid(), case when p_env = 'dev' then 'dev' else 'main' end, left(p_p256dh, 200), left(p_auth, 100))
  on conflict (endpoint) do update set user_id = excluded.user_id, env = excluded.env,
    p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
