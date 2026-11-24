-- Friends by link instead of typed codes (docs/plan-friend-quizzes.md, "Friend links").
-- Every player has one reusable, unguessable link token; opening the link and tapping Add makes
-- both players friends. "New link" replaces the token (the old link stops working; friends stay).

alter table public.quiz_players
  add column if not exists invite_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists quiz_players_invite_token on public.quiz_players (invite_token);

-- Typed friend codes are gone.
drop function if exists public.quiz_add_friend(text);
drop function if exists public.quiz_new_code();
drop table if exists public.quiz_code_tries;

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
  return jsonb_build_object('link', pl.invite_token, 'name', pl.name);
end $$;

create or replace function public.quiz_new_link()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.quiz_players set invite_token = replace(gen_random_uuid()::text, '-', '') where user_id = auth.uid();
  return public.quiz_me();
end $$;

-- Whose link is this? (shown before the player taps Add)
create or replace function public.quiz_invite_peek(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them public.quiz_players;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into them from public.quiz_players where invite_token = left(coalesce(p_token, ''), 64);
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if them.user_id = me then return jsonb_build_object('error', 'self'); end if;
  return jsonb_build_object('name', them.name,
    'already', exists (select 1 from public.quiz_friends where user_id = me and friend_id = them.user_id));
end $$;

create or replace function public.quiz_invite_accept(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them public.quiz_players;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into them from public.quiz_players where invite_token = left(coalesce(p_token, ''), 64);
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if them.user_id = me then return jsonb_build_object('error', 'self'); end if;
  insert into public.quiz_friends (user_id, friend_id) values (me, them.user_id), (them.user_id, me)
  on conflict do nothing;
  return jsonb_build_object('id', them.user_id, 'name', them.name);
end $$;

revoke execute on function public.quiz_new_link(), public.quiz_invite_peek(text), public.quiz_invite_accept(text) from public, anon;
grant execute on function public.quiz_new_link(), public.quiz_invite_peek(text), public.quiz_invite_accept(text) to authenticated;
