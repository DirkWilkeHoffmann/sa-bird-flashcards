-- Usage events the app may log (applied 2 Nov 2026). Events not on this list are dropped silently,
-- so every new logEvent("…") type has to be added here. Added: the Dirk Progression, bird lists
-- and walkthrough events from Dev (never recorded before this), and the daily goal.
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
                    'daily_goal');
end;
$function$;
