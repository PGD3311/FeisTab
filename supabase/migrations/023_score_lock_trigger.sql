-- Prevent score writes after a judge has signed off for that round.
-- This is the DB-level safety net — the UI also blocks, but a stale tab could bypass it.
create or replace function check_score_not_locked()
returns trigger
language plpgsql
as $$
declare
  v_sign_offs jsonb;
begin
  -- Get current sign-offs for this round
  select judge_sign_offs into v_sign_offs
  from rounds
  where id = NEW.round_id;

  -- If this judge has already signed off, reject the write
  if v_sign_offs is not null and v_sign_offs ? NEW.judge_id::text then
    raise exception 'Score rejected: judge % has already signed off for this round', NEW.judge_id;
  end if;

  return NEW;
end;
$$;

create trigger trg_score_not_locked
  before insert or update on score_entries
  for each row
  execute function check_score_not_locked();
