create or replace function publish_results(
  p_competition_id uuid,
  p_approved_by text,
  p_expected_status text default 'complete_unpublished'
)
returns void
language plpgsql
as $$
declare
  v_now timestamptz := now();
begin
  -- Guard: only publish from expected status
  update competitions
  set status = 'published',
      approved_by = p_approved_by,
      approved_at = v_now,
      unpublished_by = null,
      unpublished_at = null
  where id = p_competition_id
    and status = p_expected_status;

  if not found then
    raise exception 'Competition not in expected status (%)' , p_expected_status;
  end if;

  update results
  set published_at = v_now
  where competition_id = p_competition_id;
end;
$$;

create or replace function unpublish_results(
  p_competition_id uuid,
  p_unpublished_by text,
  p_expected_status text default 'published'
)
returns void
language plpgsql
as $$
declare
  v_now timestamptz := now();
begin
  update competitions
  set status = 'complete_unpublished',
      unpublished_by = p_unpublished_by,
      unpublished_at = v_now,
      approved_by = null,
      approved_at = null
  where id = p_competition_id
    and status = p_expected_status;

  if not found then
    raise exception 'Competition not in expected status (%)' , p_expected_status;
  end if;

  update results
  set published_at = null
  where competition_id = p_competition_id;
end;
$$;
