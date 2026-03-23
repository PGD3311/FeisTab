-- Atomically add or remove a judge's sign-off from a round's judge_sign_offs JSONB.
-- Returns the updated sign-offs object.
create or replace function sign_off_judge(
  p_round_id uuid,
  p_judge_id uuid,
  p_competition_id uuid,
  p_action text default 'add'  -- 'add' or 'remove'
)
returns jsonb
language plpgsql
as $$
declare
  v_current jsonb;
  v_updated jsonb;
begin
  -- Lock the row to prevent concurrent modification, verify round belongs to competition
  select judge_sign_offs into v_current
  from rounds
  where id = p_round_id
    and competition_id = p_competition_id
  for update;

  if not found then
    raise exception 'Round % not found', p_round_id;
  end if;

  v_current := coalesce(v_current, '{}'::jsonb);

  if p_action = 'add' then
    v_updated := v_current || jsonb_build_object(p_judge_id::text, to_jsonb(now()::text));
  elsif p_action = 'remove' then
    v_updated := v_current - p_judge_id::text;
  else
    raise exception 'Invalid action: %', p_action;
  end if;

  update rounds
  set judge_sign_offs = v_updated
  where id = p_round_id;

  return v_updated;
end;
$$;
