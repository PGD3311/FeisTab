-- Migration 025: Harden 5 existing RPCs with SECURITY DEFINER + role validation
-- Adds: SECURITY DEFINER, SET search_path = public, role checks, audit log entries

-- RPC 1: sign_off_judge
CREATE OR REPLACE FUNCTION sign_off_judge(
  p_round_id uuid,
  p_judge_id uuid,
  p_competition_id uuid,
  p_action text DEFAULT 'add'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_current jsonb;
  v_updated jsonb;
BEGIN
  -- Get event_id
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;

  -- Auth: must be this judge or organizer
  IF NOT EXISTS (SELECT 1 FROM judges j WHERE j.id = p_judge_id AND j.user_id = auth.uid()) THEN
    IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
      RAISE EXCEPTION 'not authorized: must be assigned judge or organizer';
    END IF;
  END IF;

  -- Original business logic (preserved)
  SELECT judge_sign_offs INTO v_current
  FROM rounds WHERE id = p_round_id AND competition_id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round % not found', p_round_id; END IF;
  v_current := COALESCE(v_current, '{}'::jsonb);

  IF p_action = 'add' THEN
    v_updated := v_current || jsonb_build_object(p_judge_id::text, to_jsonb(now()::text));
  ELSIF p_action = 'remove' THEN
    v_updated := v_current - p_judge_id::text;
  ELSE
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  UPDATE rounds SET judge_sign_offs = v_updated WHERE id = p_round_id;

  -- Audit
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'round', p_round_id, 'sign_off_judge',
    jsonb_build_object('judge_id', p_judge_id, 'action', p_action));

  RETURN v_updated;
END;
$$;

-- RPC 2: publish_results
CREATE OR REPLACE FUNCTION publish_results(
  p_competition_id uuid,
  p_approved_by text,
  p_expected_status text DEFAULT 'complete_unpublished'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;

  UPDATE competitions
  SET status = 'published', approved_by = p_approved_by, approved_at = v_now,
      unpublished_by = NULL, unpublished_at = NULL
  WHERE id = p_competition_id AND status = p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competition not in expected status (%)', p_expected_status; END IF;

  UPDATE results SET published_at = v_now WHERE competition_id = p_competition_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'publish_results',
    jsonb_build_object('approved_by', p_approved_by));
END;
$$;

-- RPC 3: unpublish_results
CREATE OR REPLACE FUNCTION unpublish_results(
  p_competition_id uuid,
  p_unpublished_by text,
  p_expected_status text DEFAULT 'published'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;

  UPDATE competitions
  SET status = 'complete_unpublished', unpublished_by = p_unpublished_by, unpublished_at = v_now,
      approved_by = NULL, approved_at = NULL
  WHERE id = p_competition_id AND status = p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competition not in expected status (%)', p_expected_status; END IF;

  UPDATE results SET published_at = NULL WHERE competition_id = p_competition_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'unpublish_results',
    jsonb_build_object('unpublished_by', p_unpublished_by));
END;
$$;

-- RPC 4: generate_recall
CREATE OR REPLACE FUNCTION generate_recall(
  p_competition_id uuid,
  p_recall_rows jsonb,
  p_next_round_number int,
  p_expected_status text DEFAULT 'ready_to_tabulate'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_round_id uuid;
  v_row jsonb;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;

  IF jsonb_array_length(p_recall_rows) = 0 THEN
    RAISE EXCEPTION 'No recalls to generate';
  END IF;

  UPDATE competitions SET status = 'recalled_round_pending'
  WHERE id = p_competition_id AND status = p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competition not in expected status (%)', p_expected_status; END IF;

  INSERT INTO rounds (competition_id, round_number, round_type, judge_sign_offs)
  VALUES (p_competition_id, p_next_round_number, 'recall', '{}'::jsonb)
  RETURNING id INTO v_round_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_recall_rows)
  LOOP
    INSERT INTO recalls (competition_id, source_round_id, dancer_id, recall_status)
    VALUES (p_competition_id, (v_row->>'source_round_id')::uuid, (v_row->>'dancer_id')::uuid, 'recalled')
    ON CONFLICT (competition_id, source_round_id, dancer_id)
    DO UPDATE SET recall_status = 'recalled';
  END LOOP;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'round', v_round_id, 'generate_recall',
    jsonb_build_object('competition_id', p_competition_id, 'recall_count', jsonb_array_length(p_recall_rows)));

  RETURN v_round_id;
END;
$$;

-- RPC 5: approve_tabulation
CREATE OR REPLACE FUNCTION approve_tabulation(
  p_competition_id uuid,
  p_result_rows jsonb,
  p_expected_status text DEFAULT 'ready_to_tabulate'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_row jsonb;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN
    RAISE EXCEPTION 'requires organizer role';
  END IF;

  PERFORM 1 FROM competitions
  WHERE id = p_competition_id AND status = p_expected_status FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competition not in expected status (%)', p_expected_status; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_result_rows)
  LOOP
    INSERT INTO results (competition_id, dancer_id, final_rank, display_place, calculated_payload)
    VALUES (p_competition_id, (v_row->>'dancer_id')::uuid, (v_row->>'final_rank')::int,
            v_row->>'display_place', v_row->'calculated_payload')
    ON CONFLICT (competition_id, dancer_id)
    DO UPDATE SET final_rank = EXCLUDED.final_rank, display_place = EXCLUDED.display_place,
                  calculated_payload = EXCLUDED.calculated_payload;
  END LOOP;

  UPDATE competitions SET status = 'complete_unpublished' WHERE id = p_competition_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'approve_tabulation',
    jsonb_build_object('result_count', jsonb_array_length(p_result_rows)));
END;
$$;
