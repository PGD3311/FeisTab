-- 041_side_stage_gate.sql
-- NOT auto-applied: run by hand in the Supabase SQL editor.
-- Side-stage must mark every dancer entered in a competition (present, no-show or
-- scratched) before the competition goes to the judge or starts.
--   * confirm_roster refuses while any dancer is still unmarked ('registered' or
--     'checked_in').
--   * transition_competition_status refuses ready_for_day_of -> released_to_judge or
--     in_progress unless the roster is confirmed and every dancer is marked.
-- Both functions are otherwise identical to 032_phase1_unbreak_chain.sql.
-- Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION confirm_roster(p_competition_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_status text; v_roles text[]; v_unmarked int;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM competitions WHERE id = p_competition_id FOR UPDATE;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  v_roles := user_event_role(v_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'side_stage' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or side_stage role';
  END IF;
  IF v_status NOT IN ('draft', 'imported', 'ready_for_day_of') THEN
    RAISE EXCEPTION 'roster can only be confirmed before judging starts (status %)', v_status;
  END IF;
  SELECT count(*) INTO v_unmarked FROM registrations
  WHERE competition_id = p_competition_id AND status IN ('registered', 'checked_in');
  IF v_unmarked > 0 THEN
    RAISE EXCEPTION '% dancer(s) not checked in at side-stage yet. Mark each one Present, No Show or Scratched first.', v_unmarked;
  END IF;
  UPDATE competitions SET roster_confirmed_at = now(), roster_confirmed_by = auth.uid()::text
  WHERE id = p_competition_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'confirm_roster', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION transition_competition_status(
  p_competition_id uuid, p_new_status text, p_expected_status text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_old text; v_roles text[]; v_judge boolean; v_allowed boolean;
  v_roster_confirmed_at timestamptz; v_unmarked int;
BEGIN
  SELECT event_id, status, roster_confirmed_at INTO v_event_id, v_old, v_roster_confirmed_at
  FROM competitions WHERE id = p_competition_id FOR UPDATE;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;

  v_roles := user_event_role(v_event_id);
  v_judge := is_assigned_judge(p_competition_id);
  IF cardinality(v_roles) = 0 AND NOT v_judge THEN
    RAISE EXCEPTION 'not authorized for this event';
  END IF;

  -- Already there: nothing to do (a second tap, or another device got there first)
  IF v_old = p_new_status THEN RETURN; END IF;

  IF p_expected_status IS NOT NULL AND v_old <> p_expected_status THEN
    RAISE EXCEPTION 'Competition status changed (now %) — refresh and try again', v_old;
  END IF;

  IF NOT is_valid_transition(v_old, p_new_status) THEN
    RAISE EXCEPTION 'invalid competition status change: % -> %', v_old, p_new_status;
  END IF;

  v_allowed := 'organizer' = ANY(v_roles)
    OR ('side_stage' = ANY(v_roles) AND (v_old, p_new_status) IN (
          ('imported', 'ready_for_day_of'),
          ('ready_for_day_of', 'released_to_judge'),
          ('released_to_judge', 'ready_for_day_of')))
    OR (v_judge AND p_new_status = 'in_progress' AND v_old IN ('ready_for_day_of', 'released_to_judge'));
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'your role cannot change status % -> %', v_old, p_new_status;
  END IF;

  -- Side-stage gate: nothing goes to the judge until every dancer is marked
  IF v_old = 'ready_for_day_of' AND p_new_status IN ('released_to_judge', 'in_progress') THEN
    IF v_roster_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'Side-stage must confirm the roster before this competition starts';
    END IF;
    SELECT count(*) INTO v_unmarked FROM registrations
    WHERE competition_id = p_competition_id AND status IN ('registered', 'checked_in');
    IF v_unmarked > 0 THEN
      RAISE EXCEPTION '% dancer(s) not checked in at side-stage yet. Mark each one Present, No Show or Scratched first.', v_unmarked;
    END IF;
  END IF;

  -- Audited by trg_competition_status_change
  UPDATE competitions SET status = p_new_status WHERE id = p_competition_id;
END;
$$;
