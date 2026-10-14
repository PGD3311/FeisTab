-- 035_feis_day_fixes.sql
-- Fixes from the 2026-10-14 mock feis dress rehearsal.
--
-- 1. judge_roster / side_stage_roster declared competitor_number integer but
--    event_check_ins stores text, so every call failed ("structure of query does
--    not match function result type"): judges saw "Competition not found" and
--    side-stage saw an empty roster. Convert numeric text; anything else is NULL.
-- 2. undo_check_in deleted the check-in row, throwing away a number assigned at
--    registration. Now it only clears the arrival; the dancer keeps the number.
-- 3. tabulator_enter_score had no comment parameter, so comments typed from a
--    paper sheet were dropped. It also didn't check the judge is assigned.
-- 4. Side-stage couldn't read judge_assignments, so every competition showed
--    "No judges assigned".

CREATE OR REPLACE FUNCTION judge_roster(p_comp_id uuid)
RETURNS TABLE(dancer_id uuid, first_name text, last_name text, competitor_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM judge_assignments ja
    JOIN judges j ON j.id = ja.judge_id
    WHERE ja.competition_id = p_comp_id AND j.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not assigned to this competition';
  END IF;
  RETURN QUERY
  SELECT d.id, d.first_name, d.last_name,
    CASE WHEN ec.competitor_number ~ '^[0-9]+$' THEN ec.competitor_number::integer END
  FROM registrations r
  JOIN dancers d ON d.id = r.dancer_id
  LEFT JOIN event_check_ins ec ON ec.dancer_id = d.id
    AND ec.event_id = (SELECT event_id FROM competitions WHERE id = p_comp_id)
  WHERE r.competition_id = p_comp_id;
END;
$$;

CREATE OR REPLACE FUNCTION side_stage_roster(p_comp_id uuid)
RETURNS TABLE(dancer_id uuid, first_name text, last_name text, competitor_number integer, registration_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_comp_id;
  IF NOT ('side_stage' = ANY(user_event_role(v_event_id)) OR 'organizer' = ANY(user_event_role(v_event_id))) THEN
    RAISE EXCEPTION 'requires side_stage or organizer role';
  END IF;
  RETURN QUERY
  SELECT d.id, d.first_name, d.last_name,
    CASE WHEN ec.competitor_number ~ '^[0-9]+$' THEN ec.competitor_number::integer END,
    r.status
  FROM registrations r
  JOIN dancers d ON d.id = r.dancer_id
  LEFT JOIN event_check_ins ec ON ec.dancer_id = d.id AND ec.event_id = v_event_id
  WHERE r.competition_id = p_comp_id;
END;
$$;

CREATE OR REPLACE FUNCTION undo_check_in(p_event_id uuid, p_dancer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_roles text[]; v_row event_check_ins%ROWTYPE;
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'registration_desk' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or registration_desk role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM score_entries se JOIN competitions c ON c.id = se.competition_id
    WHERE c.event_id = p_event_id AND se.dancer_id = p_dancer_id
  ) THEN
    RAISE EXCEPTION 'dancer already has scores — check-in cannot be undone';
  END IF;

  -- Keep the row and the number; only the arrival is undone
  UPDATE event_check_ins SET checked_in_at = NULL
  WHERE event_id = p_event_id AND dancer_id = p_dancer_id AND checked_in_at IS NOT NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'dancer is not checked in'; END IF;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, before_data)
  VALUES (auth.uid(), 'event_check_in', v_row.id, 'undo_check_in',
    jsonb_build_object('dancer_id', p_dancer_id, 'number', v_row.competitor_number));
END;
$$;

DROP FUNCTION IF EXISTS tabulator_enter_score(uuid, uuid, uuid, uuid, numeric, boolean, text);

CREATE FUNCTION tabulator_enter_score(
  p_competition_id uuid,
  p_round_id uuid,
  p_dancer_id uuid,
  p_judge_id uuid,
  p_raw_score numeric,
  p_flagged boolean DEFAULT false,
  p_flag_reason text DEFAULT NULL,
  p_comment_data jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_event_id uuid; v_status text; v_score_id uuid;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM judges WHERE id = p_judge_id AND event_id = v_event_id) THEN
    RAISE EXCEPTION 'judge does not belong to this event';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM judge_assignments WHERE judge_id = p_judge_id AND competition_id = p_competition_id
  ) THEN
    RAISE EXCEPTION 'judge is not assigned to this competition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rounds WHERE id = p_round_id AND competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'round does not belong to this competition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registrations WHERE competition_id = p_competition_id AND dancer_id = p_dancer_id) THEN
    RAISE EXCEPTION 'dancer is not in this competition';
  END IF;
  IF v_status NOT IN ('in_progress', 'awaiting_scores') THEN
    RAISE EXCEPTION 'competition is not open for scoring (status %)', v_status;
  END IF;
  IF EXISTS (SELECT 1 FROM score_entries se WHERE se.round_id = p_round_id AND se.dancer_id = p_dancer_id
             AND se.judge_id = p_judge_id AND se.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'score is locked after sign-off';
  END IF;
  INSERT INTO score_entries (round_id, competition_id, dancer_id, judge_id, raw_score, flagged, flag_reason, comment_data, entry_mode, entered_by_user_id, submitted_at)
  VALUES (p_round_id, p_competition_id, p_dancer_id, p_judge_id, p_raw_score, p_flagged, p_flag_reason, p_comment_data, 'tabulator_transcription', auth.uid(), now())
  ON CONFLICT (round_id, dancer_id, judge_id) DO UPDATE SET
    raw_score = EXCLUDED.raw_score, flagged = EXCLUDED.flagged, flag_reason = EXCLUDED.flag_reason,
    comment_data = EXCLUDED.comment_data, entered_by_user_id = auth.uid(), submitted_at = now()
  RETURNING id INTO v_score_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'score_entry', v_score_id, 'tabulator_enter_score', jsonb_build_object('dancer_id', p_dancer_id, 'judge_id', p_judge_id));
  RETURN v_score_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION tabulator_enter_score(uuid, uuid, uuid, uuid, numeric, boolean, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tabulator_enter_score(uuid, uuid, uuid, uuid, numeric, boolean, text, jsonb) TO authenticated;

CREATE POLICY judge_assignments_select_side_stage ON judge_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c
    WHERE c.id = judge_assignments.competition_id
      AND 'side_stage' = ANY(user_event_role(c.event_id))
  ));
