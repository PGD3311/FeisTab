-- 038_sign_off_requires_complete_sheet.sql
-- Second mock feis: a judge's sheet could be signed off (and locked) with
-- scores missing. The screens now block it; this makes the database refuse it
-- too. Every dancer still in the round (not scratched / no-show / disqualified
-- / did-not-complete / medical, and in a recall round only recalled dancers)
-- must have a score from this judge before 'add'. Otherwise unchanged from 032.

CREATE OR REPLACE FUNCTION sign_off_judge(p_round_id uuid, p_judge_id uuid, p_competition_id uuid, p_action text DEFAULT 'add')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid; v_status text; v_is_org boolean; v_is_self boolean;
  v_current jsonb; v_updated jsonb; v_assigned uuid[];
  v_round_type text; v_missing int;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM competitions WHERE id = p_competition_id FOR UPDATE;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM judges WHERE id = p_judge_id AND event_id = v_event_id) THEN
    RAISE EXCEPTION 'judge does not belong to this event';
  END IF;

  v_is_org := 'organizer' = ANY(user_event_role(v_event_id));
  v_is_self := EXISTS (SELECT 1 FROM judges WHERE id = p_judge_id AND user_id = auth.uid());

  IF p_action = 'add' THEN
    IF NOT (v_is_org OR v_is_self) THEN
      RAISE EXCEPTION 'not authorized: must be this judge or an organizer';
    END IF;
  ELSIF p_action = 'remove' THEN
    IF NOT v_is_org THEN RAISE EXCEPTION 'only an organizer can reopen a judge sign-off'; END IF;
  ELSE
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  SELECT judge_sign_offs, round_type INTO v_current, v_round_type
  FROM rounds WHERE id = p_round_id AND competition_id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round % not found', p_round_id; END IF;
  v_current := COALESCE(v_current, '{}'::jsonb);

  IF p_action = 'add' THEN
    IF v_current ? p_judge_id::text THEN RETURN v_current; END IF;
    IF v_status NOT IN ('in_progress', 'awaiting_scores') THEN
      RAISE EXCEPTION 'competition is not open for scoring (status %)', v_status;
    END IF;

    SELECT count(*) INTO v_missing
    FROM registrations r
    WHERE r.competition_id = p_competition_id
      AND r.status NOT IN ('scratched', 'no_show', 'disqualified', 'did_not_complete', 'medical')
      AND (v_round_type IS DISTINCT FROM 'recall' OR EXISTS (
        SELECT 1 FROM recalls rc
        WHERE rc.competition_id = p_competition_id AND rc.dancer_id = r.dancer_id
          AND rc.recall_status = 'recalled'))
      AND NOT EXISTS (
        SELECT 1 FROM score_entries se
        WHERE se.round_id = p_round_id AND se.judge_id = p_judge_id AND se.dancer_id = r.dancer_id);
    IF v_missing > 0 THEN
      RAISE EXCEPTION 'cannot sign off: % dancer(s) still need a score from this judge', v_missing;
    END IF;

    UPDATE score_entries SET locked_at = now()
    WHERE round_id = p_round_id AND judge_id = p_judge_id AND locked_at IS NULL;

    v_updated := v_current || jsonb_build_object(p_judge_id::text, to_jsonb(now()::text));
    UPDATE rounds SET judge_sign_offs = v_updated WHERE id = p_round_id;

    SELECT array_agg(judge_id) INTO v_assigned FROM judge_assignments WHERE competition_id = p_competition_id;
    IF v_assigned IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM unnest(v_assigned) a WHERE NOT (v_updated ? a::text)) THEN
      IF v_status = 'in_progress' THEN
        UPDATE competitions SET status = 'awaiting_scores' WHERE id = p_competition_id;
        v_status := 'awaiting_scores';
      END IF;
      UPDATE competitions SET status = 'ready_to_tabulate' WHERE id = p_competition_id;
    END IF;
  ELSE
    v_updated := v_current - p_judge_id::text;
    UPDATE rounds SET judge_sign_offs = v_updated WHERE id = p_round_id;
    UPDATE score_entries SET locked_at = NULL WHERE round_id = p_round_id AND judge_id = p_judge_id;
  END IF;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'round', p_round_id, 'sign_off_judge',
    jsonb_build_object('judge_id', p_judge_id, 'action', p_action));
  RETURN v_updated;
END;
$$;
