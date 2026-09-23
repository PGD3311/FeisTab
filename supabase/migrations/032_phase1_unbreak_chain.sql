-- 032_phase1_unbreak_chain.sql
-- Phase 1 "Unbreak the chain" (plan: docs/superpowers/plans/2026-09-22-phase1-unbreak-the-chain.md)
-- Tests: supabase/tests/032_phase1_rpc_tests.sql
--
-- Migrations 028/029 set most table writes to USING (false), but ~20 client
-- pages still wrote directly. Postgres drops RLS-filtered UPDATE/DELETE rows
-- without an error, so those actions "succeeded" on screen and saved nothing.
-- Every such write now goes through a role-checked SECURITY DEFINER function.
-- Also closes the cross-event holes found in the 2026-09-22 audit.

-------------------------------------------------------
-- 0. Registration statuses the app already offers
-------------------------------------------------------
ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_status_check;
ALTER TABLE registrations ADD CONSTRAINT registrations_status_check CHECK (status IN (
  'registered', 'checked_in', 'present', 'scratched', 'no_show', 'danced',
  'recalled', 'disqualified', 'finalized', 'did_not_complete', 'medical'
));

-------------------------------------------------------
-- 0b. Irish Points rule set — the data half of 002_irish_points.sql never reached
--     the live DB, which still had the old raw-average config (no countback
--     tie-breaker, no recall_top_percent) under the old name.
-------------------------------------------------------
UPDATE rule_sets
SET config = '{"score_min":0,"score_max":100,"scoring_method":"irish_points","tie_breaker":"countback","recall_top_percent":50,"drop_high":false,"drop_low":false}'::jsonb,
    scoring_method = 'irish_points',
    name = 'Default - Irish Points'
WHERE name = 'Default - Raw Score Average';

-------------------------------------------------------
-- 1. Helpers
-------------------------------------------------------

-- Must match `transitions` in src/lib/competition-states.ts.
-- Enforced by tests/db/transition-parity.test.ts.
CREATE OR REPLACE FUNCTION is_valid_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (p_from, p_to) IN (
    ('draft', 'imported'),
    ('imported', 'ready_for_day_of'),
    ('ready_for_day_of', 'released_to_judge'),
    ('ready_for_day_of', 'in_progress'),
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

-- True when the caller is a judge assigned to this competition.
-- SECURITY DEFINER so it can be used inside RLS policies.
CREATE OR REPLACE FUNCTION is_assigned_judge(p_competition_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM judge_assignments ja
    JOIN judges j ON j.id = ja.judge_id
    WHERE ja.competition_id = p_competition_id AND j.user_id = auth.uid()
  )
$$;

-------------------------------------------------------
-- 2. State machine guard — no invalid status change, from any path
-------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_competition_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT is_valid_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid competition status change: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_status_guard ON competitions;
CREATE TRIGGER trg_competition_status_guard
  BEFORE UPDATE OF status ON competitions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION guard_competition_status();

-- 027's audit trigger wrote columns that status_changes (a per-dancer table) doesn't
-- have, so EVERY competition status change failed. Log to audit_log instead; this
-- trigger is the single record of competition status changes, whatever the path.
CREATE OR REPLACE FUNCTION log_competition_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_log (user_id, entity_type, entity_id, action, before_data, after_data)
    VALUES (auth.uid(), 'competition', NEW.id, 'status_change',
      jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

-------------------------------------------------------
-- 3. transition_competition_status — role-aware, optional expected status
-------------------------------------------------------
DROP FUNCTION IF EXISTS transition_competition_status(uuid, text);
CREATE FUNCTION transition_competition_status(
  p_competition_id uuid, p_new_status text, p_expected_status text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_old text; v_roles text[]; v_judge boolean; v_allowed boolean;
BEGIN
  SELECT event_id, status INTO v_event_id, v_old FROM competitions WHERE id = p_competition_id FOR UPDATE;
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

  -- Audited by trg_competition_status_change
  UPDATE competitions SET status = p_new_status WHERE id = p_competition_id;
END;
$$;

-------------------------------------------------------
-- 4. sign_off_judge — locks scores, auto-advances when all assigned judges are done
-------------------------------------------------------
CREATE OR REPLACE FUNCTION sign_off_judge(
  p_round_id uuid, p_judge_id uuid, p_competition_id uuid, p_action text DEFAULT 'add'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event_id uuid; v_status text; v_is_org boolean; v_is_self boolean;
  v_current jsonb; v_updated jsonb; v_assigned uuid[];
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

  SELECT judge_sign_offs INTO v_current
  FROM rounds WHERE id = p_round_id AND competition_id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round % not found', p_round_id; END IF;
  v_current := COALESCE(v_current, '{}'::jsonb);

  IF p_action = 'add' THEN
    -- Second tap / other device: already signed off
    IF v_current ? p_judge_id::text THEN RETURN v_current; END IF;
    IF v_status NOT IN ('in_progress', 'awaiting_scores') THEN
      RAISE EXCEPTION 'competition is not open for scoring (status %)', v_status;
    END IF;

    -- Lock first: trg_score_not_locked rejects score writes once the sign-off exists
    UPDATE score_entries SET locked_at = now()
    WHERE round_id = p_round_id AND judge_id = p_judge_id AND locked_at IS NULL;

    v_updated := v_current || jsonb_build_object(p_judge_id::text, to_jsonb(now()::text));
    UPDATE rounds SET judge_sign_offs = v_updated WHERE id = p_round_id;

    -- Every assigned judge signed off → ready_to_tabulate (no assignments → organizer advances)
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

-------------------------------------------------------
-- 5. unlock_for_correction — one atomic step, reason recorded
-------------------------------------------------------
CREATE OR REPLACE FUNCTION unlock_for_correction(
  p_competition_id uuid, p_judge_id uuid, p_reason text, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_status text; v_round_id uuid; v_deleted int;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM competitions WHERE id = p_competition_id FOR UPDATE;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'a reason is required'; END IF;
  IF p_reason = 'other' AND COALESCE(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'a note is required when the reason is "other"';
  END IF;
  IF v_status NOT IN ('ready_to_tabulate', 'complete_unpublished') THEN
    RAISE EXCEPTION 'can only unlock before results are published (status %)', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM judges WHERE id = p_judge_id AND event_id = v_event_id) THEN
    RAISE EXCEPTION 'judge does not belong to this event';
  END IF;

  SELECT id INTO v_round_id FROM rounds WHERE competition_id = p_competition_id
  ORDER BY round_number DESC LIMIT 1;
  IF v_round_id IS NULL THEN RAISE EXCEPTION 'no round to unlock'; END IF;

  UPDATE rounds SET judge_sign_offs = COALESCE(judge_sign_offs, '{}'::jsonb) - p_judge_id::text
  WHERE id = v_round_id;
  UPDATE score_entries SET locked_at = NULL WHERE round_id = v_round_id AND judge_id = p_judge_id;
  DELETE FROM results WHERE competition_id = p_competition_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  UPDATE competitions SET status = 'awaiting_scores' WHERE id = p_competition_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, before_data, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'unlock_for_correction',
    jsonb_build_object('status', v_status, 'results_cleared', v_deleted),
    jsonb_build_object('judge_id', p_judge_id, 'round_id', v_round_id, 'reason', p_reason, 'note', p_note));
END;
$$;

-------------------------------------------------------
-- 6. set_registration_status — side-stage / organizer; patches heat snapshot
-------------------------------------------------------
DROP FUNCTION IF EXISTS update_stage_status(uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION set_registration_status(p_registration_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reg registrations%ROWTYPE; v_roles text[]; v_comp_status text; v_round_id uuid;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration not found'; END IF;
  v_roles := user_event_role(v_reg.event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'side_stage' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or side_stage role';
  END IF;

  SELECT status INTO v_comp_status FROM competitions WHERE id = v_reg.competition_id;
  IF v_comp_status IN ('ready_to_tabulate', 'recalled_round_pending', 'complete_unpublished', 'published', 'locked') THEN
    RAISE EXCEPTION 'roster is locked once judging is finished (status %)', v_comp_status;
  END IF;

  UPDATE registrations SET status = p_status, updated_at = now() WHERE id = p_registration_id;

  -- Keep the judge's heat list in step: mark the dancer's slot scratched/no-show
  IF p_status IN ('scratched', 'no_show') THEN
    SELECT id INTO v_round_id FROM rounds WHERE competition_id = v_reg.competition_id
    ORDER BY round_number DESC LIMIT 1;
    UPDATE rounds r SET heat_snapshot = jsonb_set(r.heat_snapshot, '{heats}', (
      SELECT COALESCE(jsonb_agg(
        jsonb_set(h.heat, '{slots}', (
          SELECT COALESCE(jsonb_agg(
            CASE WHEN s.slot->>'dancer_id' = v_reg.dancer_id::text
              THEN jsonb_set(s.slot, '{status}', to_jsonb(p_status)) ELSE s.slot END
            ORDER BY s.ord), '[]'::jsonb)
          FROM jsonb_array_elements(h.heat->'slots') WITH ORDINALITY AS s(slot, ord)))
        ORDER BY h.ord), '[]'::jsonb)
      FROM jsonb_array_elements(r.heat_snapshot->'heats') WITH ORDINALITY AS h(heat, ord)))
    WHERE r.id = v_round_id AND jsonb_typeof(r.heat_snapshot->'heats') = 'array';
  END IF;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, before_data, after_data)
  VALUES (auth.uid(), 'registration', p_registration_id, 'set_registration_status',
    jsonb_build_object('status', v_reg.status),
    jsonb_build_object('status', p_status, 'dancer_id', v_reg.dancer_id, 'competition_id', v_reg.competition_id));
END;
$$;

-------------------------------------------------------
-- 7. Roster confirm / un-confirm — side-stage or organizer
--    (the old confirm_roster set a column that doesn't exist and always failed)
-------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_roster(p_competition_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_status text; v_roles text[];
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
  UPDATE competitions SET roster_confirmed_at = now(), roster_confirmed_by = auth.uid()::text
  WHERE id = p_competition_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'confirm_roster', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION unconfirm_roster(p_competition_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_status text; v_roles text[];
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM competitions WHERE id = p_competition_id FOR UPDATE;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  v_roles := user_event_role(v_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'side_stage' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or side_stage role';
  END IF;
  IF v_status NOT IN ('draft', 'imported', 'ready_for_day_of') THEN
    RAISE EXCEPTION 'roster can only be un-confirmed before judging starts (status %)', v_status;
  END IF;
  UPDATE competitions SET roster_confirmed_at = NULL, roster_confirmed_by = NULL WHERE id = p_competition_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'unconfirm_roster', '{}'::jsonb);
END;
$$;

-------------------------------------------------------
-- 8. Rounds and heat snapshots — judges can start their own competition
-------------------------------------------------------
DROP FUNCTION IF EXISTS create_round(uuid, int, text);
CREATE FUNCTION create_round(p_competition_id uuid, p_round_number int, p_round_type text DEFAULT 'standard')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_round_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT ('organizer' = ANY(user_event_role(v_event_id)) OR is_assigned_judge(p_competition_id)) THEN
    RAISE EXCEPTION 'requires organizer role or judge assignment';
  END IF;

  -- Idempotent: two judges starting at once get the same round
  INSERT INTO rounds (competition_id, round_number, round_type, judge_sign_offs)
  VALUES (p_competition_id, p_round_number, p_round_type, '{}'::jsonb)
  ON CONFLICT (competition_id, round_number) DO NOTHING
  RETURNING id INTO v_round_id;
  IF v_round_id IS NULL THEN
    SELECT id INTO v_round_id FROM rounds WHERE competition_id = p_competition_id AND round_number = p_round_number;
    RETURN v_round_id;
  END IF;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'round', v_round_id, 'create_round',
    jsonb_build_object('competition_id', p_competition_id, 'round_number', p_round_number));
  RETURN v_round_id;
END;
$$;

CREATE OR REPLACE FUNCTION update_heat_snapshot(p_round_id uuid, p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_comp_id uuid; v_current jsonb; v_roles text[];
BEGIN
  SELECT c.event_id, c.id, r.heat_snapshot INTO v_event_id, v_comp_id, v_current
  FROM rounds r JOIN competitions c ON c.id = r.competition_id WHERE r.id = p_round_id FOR UPDATE OF r;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'round not found'; END IF;
  v_roles := user_event_role(v_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'side_stage' = ANY(v_roles)
          OR (is_assigned_judge(v_comp_id) AND v_current IS NULL)) THEN
    RAISE EXCEPTION 'not authorized to change the heat list';
  END IF;
  UPDATE rounds SET heat_snapshot = p_snapshot WHERE id = p_round_id;
END;
$$;

-------------------------------------------------------
-- 9. Registration desk — check-in syncs the number; undo is real
-------------------------------------------------------
CREATE OR REPLACE FUNCTION check_in_dancer(p_event_id uuid, p_dancer_id uuid, p_competitor_number int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roles text[]; v_checkin_id uuid;
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'registration_desk' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or registration_desk role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registrations WHERE event_id = p_event_id AND dancer_id = p_dancer_id) THEN
    RAISE EXCEPTION 'dancer is not registered for this event';
  END IF;
  IF p_competitor_number IS NULL OR p_competitor_number <= 0 THEN
    RAISE EXCEPTION 'competitor number must be a positive number';
  END IF;

  INSERT INTO event_check_ins (event_id, dancer_id, competitor_number, checked_in_at, checked_in_by)
  VALUES (p_event_id, p_dancer_id, p_competitor_number::text, now(), 'registration_desk')
  ON CONFLICT (event_id, dancer_id) DO UPDATE SET
    competitor_number = EXCLUDED.competitor_number, checked_in_at = now(), checked_in_by = EXCLUDED.checked_in_by
  RETURNING id INTO v_checkin_id;

  UPDATE registrations SET competitor_number = p_competitor_number::text
  WHERE event_id = p_event_id AND dancer_id = p_dancer_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'event_check_in', v_checkin_id, 'check_in_dancer',
    jsonb_build_object('dancer_id', p_dancer_id, 'number', p_competitor_number));
  RETURN v_checkin_id;
END;
$$;

CREATE OR REPLACE FUNCTION undo_check_in(p_event_id uuid, p_dancer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  DELETE FROM event_check_ins WHERE event_id = p_event_id AND dancer_id = p_dancer_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'dancer is not checked in'; END IF;
  UPDATE registrations SET competitor_number = NULL WHERE event_id = p_event_id AND dancer_id = p_dancer_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, before_data)
  VALUES (auth.uid(), 'event_check_in', v_row.id, 'undo_check_in',
    jsonb_build_object('dancer_id', p_dancer_id, 'number', v_row.competitor_number));
END;
$$;

CREATE OR REPLACE FUNCTION register_dancer(p_event_id uuid, p_competition_id uuid, p_dancer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_roles text[]; v_reg_id uuid;
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'registration_desk' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or registration_desk role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM competitions WHERE id = p_competition_id AND event_id = p_event_id) THEN
    RAISE EXCEPTION 'competition does not belong to this event';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dancers WHERE id = p_dancer_id) THEN
    RAISE EXCEPTION 'dancer not found';
  END IF;
  INSERT INTO registrations (event_id, competition_id, dancer_id, status)
  VALUES (p_event_id, p_competition_id, p_dancer_id, 'registered')
  ON CONFLICT (competition_id, dancer_id) DO NOTHING
  RETURNING id INTO v_reg_id;
  IF v_reg_id IS NOT NULL THEN
    INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
    VALUES (auth.uid(), 'registration', v_reg_id, 'register_dancer',
      jsonb_build_object('dancer_id', p_dancer_id, 'competition_id', p_competition_id));
  END IF;
  RETURN v_reg_id;
END;
$$;

-------------------------------------------------------
-- 10. Score writes — round, dancer and judge must belong to the competition
-------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_score(
  p_competition_id uuid, p_round_id uuid, p_dancer_id uuid,
  p_raw_score numeric, p_flagged boolean DEFAULT false,
  p_flag_reason text DEFAULT NULL, p_comment_data jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_status text; v_judge_id uuid; v_score_id uuid;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  SELECT j.id INTO v_judge_id FROM judges j WHERE j.user_id = auth.uid() AND j.event_id = v_event_id;
  IF v_judge_id IS NULL THEN RAISE EXCEPTION 'not a judge for this event'; END IF;
  IF NOT EXISTS (SELECT 1 FROM judge_assignments ja WHERE ja.judge_id = v_judge_id AND ja.competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'not assigned to this competition';
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
             AND se.judge_id = v_judge_id AND se.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'score is locked after sign-off';
  END IF;
  INSERT INTO score_entries (round_id, competition_id, dancer_id, judge_id, raw_score, flagged, flag_reason, comment_data, entry_mode, submitted_at)
  VALUES (p_round_id, p_competition_id, p_dancer_id, v_judge_id, p_raw_score, p_flagged, p_flag_reason, p_comment_data, 'judge_self_service', now())
  ON CONFLICT (round_id, dancer_id, judge_id) DO UPDATE SET
    raw_score = EXCLUDED.raw_score, flagged = EXCLUDED.flagged, flag_reason = EXCLUDED.flag_reason,
    comment_data = EXCLUDED.comment_data, submitted_at = now()
  RETURNING id INTO v_score_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'score_entry', v_score_id, 'submit_score', jsonb_build_object('dancer_id', p_dancer_id, 'raw_score', p_raw_score));
  RETURN v_score_id;
END;
$$;

CREATE OR REPLACE FUNCTION tabulator_enter_score(
  p_competition_id uuid, p_round_id uuid, p_dancer_id uuid,
  p_judge_id uuid, p_raw_score numeric,
  p_flagged boolean DEFAULT false, p_flag_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_status text; v_score_id uuid;
BEGIN
  SELECT event_id, status INTO v_event_id, v_status FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM judges WHERE id = p_judge_id AND event_id = v_event_id) THEN
    RAISE EXCEPTION 'judge does not belong to this event';
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
  INSERT INTO score_entries (round_id, competition_id, dancer_id, judge_id, raw_score, flagged, flag_reason, entry_mode, entered_by_user_id, submitted_at)
  VALUES (p_round_id, p_competition_id, p_dancer_id, p_judge_id, p_raw_score, p_flagged, p_flag_reason, 'tabulator_transcription', auth.uid(), now())
  ON CONFLICT (round_id, dancer_id, judge_id) DO UPDATE SET
    raw_score = EXCLUDED.raw_score, flagged = EXCLUDED.flagged, flag_reason = EXCLUDED.flag_reason,
    entered_by_user_id = auth.uid(), submitted_at = now()
  RETURNING id INTO v_score_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'score_entry', v_score_id, 'tabulator_enter_score', jsonb_build_object('dancer_id', p_dancer_id, 'judge_id', p_judge_id));
  RETURN v_score_id;
END;
$$;

-------------------------------------------------------
-- 11. CSV import — one atomic call
-------------------------------------------------------
CREATE OR REPLACE FUNCTION import_event_rows(p_event_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb; v_dancer_id uuid; v_comp_id uuid; v_ruleset uuid; v_code text;
  v_num text; v_key text; v_existing text; v_n int;
  v_numbers jsonb := '{}'::jsonb;
  v_comps_created int := 0; v_regs int := 0; v_checkins int := 0;
  v_conflicts uuid[] := '{}';
BEGIN
  IF NOT 'organizer' = ANY(user_event_role(p_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'no rows to import';
  END IF;
  SELECT id INTO v_ruleset FROM rule_sets WHERE name = 'Default - Irish Points' LIMIT 1;
  IF v_ruleset IS NULL THEN RAISE EXCEPTION 'default rule set "Default - Irish Points" is missing'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF COALESCE(btrim(v_row->>'first_name'), '') = '' OR COALESCE(btrim(v_row->>'last_name'), '') = ''
       OR COALESCE(btrim(v_row->>'competition_code'), '') = '' THEN
      RAISE EXCEPTION 'every row needs first_name, last_name and competition_code';
    END IF;

    -- Dancers are shared across events: only fill blanks on an existing dancer
    INSERT INTO dancers (first_name, last_name, school_name, teacher_name, date_of_birth)
    VALUES (btrim(v_row->>'first_name'), btrim(v_row->>'last_name'),
            NULLIF(btrim(v_row->>'school_name'), ''), NULLIF(btrim(v_row->>'teacher_name'), ''),
            NULLIF(btrim(v_row->>'date_of_birth'), '')::date)
    ON CONFLICT (first_name, last_name, (COALESCE(school_name, ''::text))) DO UPDATE SET
      teacher_name = COALESCE(dancers.teacher_name, EXCLUDED.teacher_name),
      date_of_birth = COALESCE(dancers.date_of_birth, EXCLUDED.date_of_birth)
    RETURNING id INTO v_dancer_id;

    v_code := btrim(v_row->>'competition_code');
    SELECT id INTO v_comp_id FROM competitions WHERE event_id = p_event_id AND code = v_code;
    IF v_comp_id IS NULL THEN
      INSERT INTO competitions (event_id, code, name, age_group, level, dance_type, status, ruleset_id)
      VALUES (p_event_id, v_code, COALESCE(NULLIF(btrim(v_row->>'competition_name'), ''), v_code),
              NULLIF(btrim(v_row->>'age_group'), ''), NULLIF(btrim(v_row->>'level'), ''),
              NULLIF(btrim(v_row->>'dance_type'), ''), 'imported', v_ruleset)
      RETURNING id INTO v_comp_id;
      INSERT INTO rounds (competition_id, round_number, round_type, judge_sign_offs)
      VALUES (v_comp_id, 1, 'standard', '{}'::jsonb);
      v_comps_created := v_comps_created + 1;
    END IF;

    INSERT INTO registrations (event_id, dancer_id, competition_id, status)
    VALUES (p_event_id, v_dancer_id, v_comp_id, 'registered')
    ON CONFLICT (competition_id, dancer_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_regs := v_regs + v_n;

    -- One number per dancer; two different numbers in the file is a conflict
    v_num := NULLIF(btrim(v_row->>'competitor_number'), '');
    IF v_num IS NOT NULL THEN
      v_key := v_dancer_id::text;
      IF NOT (v_numbers ? v_key) THEN
        v_numbers := v_numbers || jsonb_build_object(v_key, v_num);
      ELSIF v_numbers->>v_key <> v_num THEN
        v_numbers := v_numbers || jsonb_build_object(v_key, NULL);
      END IF;
    END IF;
  END LOOP;

  FOR v_key, v_num IN SELECT key, value #>> '{}' FROM jsonb_each(v_numbers) LOOP
    v_dancer_id := v_key::uuid;
    IF v_num IS NULL THEN v_conflicts := v_conflicts || v_dancer_id; CONTINUE; END IF;

    SELECT competitor_number INTO v_existing FROM event_check_ins
    WHERE event_id = p_event_id AND dancer_id = v_dancer_id;
    IF FOUND THEN
      IF v_existing IS DISTINCT FROM v_num THEN v_conflicts := v_conflicts || v_dancer_id; END IF;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM event_check_ins WHERE event_id = p_event_id AND competitor_number = v_num) THEN
      v_conflicts := v_conflicts || v_dancer_id;
      CONTINUE;
    END IF;

    INSERT INTO event_check_ins (event_id, dancer_id, competitor_number, checked_in_by)
    VALUES (p_event_id, v_dancer_id, v_num, 'import');
    UPDATE registrations SET competitor_number = v_num WHERE event_id = p_event_id AND dancer_id = v_dancer_id;
    v_checkins := v_checkins + 1;
  END LOOP;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'event', p_event_id, 'import_event_rows', jsonb_build_object(
    'rows', jsonb_array_length(p_rows), 'competitions_created', v_comps_created,
    'registrations', v_regs, 'check_ins', v_checkins, 'conflicts', cardinality(v_conflicts)));

  RETURN jsonb_build_object(
    'competitions_created', v_comps_created, 'registrations', v_regs,
    'check_ins', v_checkins, 'conflicts', to_jsonb(v_conflicts));
END;
$$;

-------------------------------------------------------
-- 12. Deleting events and judges — never destroys published results or scores
-------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_event(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  IF NOT 'organizer' = ANY(user_event_role(p_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  IF EXISTS (SELECT 1 FROM competitions WHERE event_id = p_event_id AND status IN ('published', 'locked')) THEN
    RAISE EXCEPTION 'this event has published results and cannot be deleted';
  END IF;
  SELECT name INTO v_name FROM events WHERE id = p_event_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, before_data)
  VALUES (auth.uid(), 'event', p_event_id, 'delete_event', jsonb_build_object('name', v_name));
  DELETE FROM events WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION remove_judge(p_judge_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_judge judges%ROWTYPE;
BEGIN
  SELECT * INTO v_judge FROM judges WHERE id = p_judge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'judge not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_judge.event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  IF EXISTS (SELECT 1 FROM score_entries WHERE judge_id = p_judge_id) THEN
    RAISE EXCEPTION 'this judge has entered scores and cannot be removed';
  END IF;
  DELETE FROM pending_invitations WHERE judge_id = p_judge_id;
  IF v_judge.user_id IS NOT NULL THEN
    DELETE FROM event_roles WHERE event_id = v_judge.event_id AND user_id = v_judge.user_id AND role = 'judge';
  END IF;
  DELETE FROM judges WHERE id = p_judge_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, before_data)
  VALUES (auth.uid(), 'judge', p_judge_id, 'remove_judge',
    jsonb_build_object('name', v_judge.first_name || ' ' || v_judge.last_name, 'event_id', v_judge.event_id));
END;
$$;

-------------------------------------------------------
-- 13. Public results — narrow read functions (no DOB, published data only)
-------------------------------------------------------
CREATE OR REPLACE FUNCTION public_event_results(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'name', e.name, 'start_date', e.start_date, 'location', e.location),
    'competitions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', c.code, 'name', c.name, 'age_group', c.age_group, 'level', c.level,
        'results', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'final_rank', r.final_rank, 'calculated_payload', r.calculated_payload,
            'published_at', r.published_at, 'dancer_id', r.dancer_id,
            'dancers', jsonb_build_object('id', d.id, 'first_name', d.first_name, 'last_name', d.last_name)
          ) ORDER BY r.final_rank)
          FROM results r JOIN dancers d ON d.id = r.dancer_id
          WHERE r.competition_id = c.id AND r.published_at IS NOT NULL
        ), '[]'::jsonb)
      ) ORDER BY c.code)
      FROM competitions c
      WHERE c.event_id = e.id AND c.status IN ('published', 'locked')
    ), '[]'::jsonb)
  )
  FROM events e WHERE e.id = p_event_id
$$;

CREATE OR REPLACE FUNCTION public_feedback_header(p_event_id uuid, p_dancer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'name', e.name, 'start_date', e.start_date),
    'dancer', jsonb_build_object('first_name', d.first_name, 'last_name', d.last_name)
  )
  FROM events e, dancers d
  WHERE e.id = p_event_id AND d.id = p_dancer_id
    AND EXISTS (
      SELECT 1 FROM results r JOIN competitions c ON c.id = r.competition_id
      WHERE r.dancer_id = d.id AND c.event_id = e.id AND r.published_at IS NOT NULL
    )
$$;

-------------------------------------------------------
-- 14. Policies
-------------------------------------------------------

-- Side-stage and assigned judges must see registration statuses (scratches)
DROP POLICY IF EXISTS registrations_select_floor ON registrations;
CREATE POLICY registrations_select_floor ON registrations FOR SELECT
  USING ('side_stage' = ANY(user_event_role(event_id)) OR is_assigned_judge(competition_id));

-- Rule sets hold the scoring rules: no client writes
DROP POLICY IF EXISTS rule_sets_insert ON rule_sets;
DROP POLICY IF EXISTS rule_sets_update ON rule_sets;
CREATE POLICY rule_sets_insert ON rule_sets FOR INSERT WITH CHECK (false);
CREATE POLICY rule_sets_update ON rule_sets FOR UPDATE USING (false);

-- An invitation can only point at a judge from the same event (stops judge takeover)
DROP POLICY IF EXISTS pending_invitations_insert ON pending_invitations;
CREATE POLICY pending_invitations_insert ON pending_invitations FOR INSERT
  WITH CHECK (
    'organizer' = ANY(user_event_role(event_id))
    AND (judge_id IS NULL OR EXISTS (
      SELECT 1 FROM judges j WHERE j.id = pending_invitations.judge_id AND j.event_id = pending_invitations.event_id))
  );

-------------------------------------------------------
-- 15. Execute grants — nothing that writes is callable without a login
-------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
  LOOP
    IF f.proname IN ('public_feedback', 'public_event_results', 'public_feedback_header',
                     'user_event_role', 'is_assigned_judge') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.sig);
    ELSIF f.proname = 'fulfill_invitation' THEN
      -- Only the server (service role) fulfils invitations
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END;
$$;
