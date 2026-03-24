create or replace function generate_recall(
  p_competition_id uuid,
  p_recall_rows jsonb,
  p_next_round_number int,
  p_expected_status text default 'complete_unpublished'
)
returns uuid
language plpgsql
as $$
declare
  v_round_id uuid;
  v_row jsonb;
begin
  -- Guard: must have at least one recall
  if jsonb_array_length(p_recall_rows) = 0 then
    raise exception 'No recalls to generate';
  end if;

  -- Guard status
  update competitions
  set status = 'recalled_round_pending'
  where id = p_competition_id
    and status = p_expected_status;

  if not found then
    raise exception 'Competition not in expected status (%)', p_expected_status;
  end if;

  -- Insert new round
  insert into rounds (competition_id, round_number, round_type, judge_sign_offs)
  values (p_competition_id, p_next_round_number, 'recall', '{}'::jsonb)
  returning id into v_round_id;

  -- Upsert recalls
  for v_row in select * from jsonb_array_elements(p_recall_rows)
  loop
    insert into recalls (competition_id, source_round_id, dancer_id, recall_status)
    values (
      p_competition_id,
      (v_row->>'source_round_id')::uuid,
      (v_row->>'dancer_id')::uuid,
      'recalled'
    )
    on conflict (competition_id, source_round_id, dancer_id)
    do update set recall_status = 'recalled';
  end loop;

  return v_round_id;
end;
$$;
