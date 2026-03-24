create or replace function approve_tabulation(
  p_competition_id uuid,
  p_result_rows jsonb,
  p_expected_status text default 'ready_to_tabulate'
)
returns void
language plpgsql
as $$
declare
  v_row jsonb;
begin
  -- Guard: must be in ready_to_tabulate, lock the row
  perform 1 from competitions
  where id = p_competition_id and status = p_expected_status
  for update;

  if not found then
    raise exception 'Competition not in expected status (%)', p_expected_status;
  end if;

  -- Upsert results
  for v_row in select * from jsonb_array_elements(p_result_rows)
  loop
    insert into results (competition_id, dancer_id, final_rank, display_place, calculated_payload)
    values (
      p_competition_id,
      (v_row->>'dancer_id')::uuid,
      (v_row->>'final_rank')::int,
      v_row->>'display_place',
      v_row->'calculated_payload'
    )
    on conflict (competition_id, dancer_id)
    do update set
      final_rank = excluded.final_rank,
      display_place = excluded.display_place,
      calculated_payload = excluded.calculated_payload;
  end loop;

  -- Advance status
  update competitions
  set status = 'complete_unpublished'
  where id = p_competition_id;
end;
$$;
