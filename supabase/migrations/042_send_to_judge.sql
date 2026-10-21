-- 042_send_to_judge.sql
-- NOT auto-applied: run by hand in the Supabase SQL editor.
-- Every competition goes through side-stage's "Send to Judge" before scoring starts.
--   * is_valid_transition no longer allows ready_for_day_of -> in_progress
--     (otherwise identical to 032_phase1_unbreak_chain.sql).
--   * transition_competition_status lets a judge start only a competition sent to them
--     (otherwise identical to 041_side_stage_gate.sql).
-- Competitions already scoring are unaffected. Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION is_valid_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (p_from, p_to) IN (
    ('draft', 'imported'),
    ('imported', 'ready_for_day_of'),
    ('ready_for_day_of', 'released_to_judge'),
    ('released_to_judge', 'in_progress'),
    ('released_to_judge', 'ready_for_day_of'),
    ('in_progress', 'awaiting_scores'),
    ('awaiting_scores', 'ready_to_tabulate'),
    ('ready_to_tabulate', 'recalled_round_pending'),
    ('ready_to_tabulate', 'complete_unpublished'),
    ('ready_to_tabulate', 'awaiting_scores'),
    ('recalled_round_pending', 'awaiting_scores'),
    ('complete_unpublished', 'published'),
    ('complete_unpublished', 'awaiting_scores'),
    ('published', 'locked'),
    ('published', 'complete_unpublished')
  )
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
    OR (v_judge AND p_new_status = 'in_progress' AND v_old = 'released_to_judge');
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
