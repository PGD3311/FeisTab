-- 026_write_rpcs.sql
-- 11 SECURITY DEFINER RPCs for all client-side writes.
-- Each validates caller role via user_event_role() and writes to audit_log.

-- 1. create_event — any authenticated user
CREATE OR REPLACE FUNCTION create_event(
  p_name text, p_start_date date, p_end_date date, p_location text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE v_event_id uuid; v_reg_code text; v_attempts int := 0;
BEGIN
  IF p_name IS NULL OR p_start_date IS NULL THEN RAISE EXCEPTION 'missing required fields'; END IF;
  LOOP
    v_reg_code := upper(substring(md5(random()::text) from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM events WHERE registration_code = v_reg_code);
    v_attempts := v_attempts + 1;
    IF v_attempts > 5 THEN RAISE EXCEPTION 'failed to generate unique code'; END IF;
  END LOOP;
  INSERT INTO events (name, start_date, end_date, location, registration_code, created_by, status)
  VALUES (p_name, p_start_date, p_end_date, p_location, v_reg_code, auth.uid(), 'draft')
  RETURNING id INTO v_event_id;
  INSERT INTO event_roles (user_id, event_id, role, created_by)
  VALUES (auth.uid(), v_event_id, 'organizer', auth.uid());
  INSERT INTO stages (event_id, name, display_order) VALUES (v_event_id, 'Stage 1', 1);
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'event', v_event_id, 'create_event', jsonb_build_object('name', p_name));
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. submit_score — judge with assignment, unlocked
CREATE OR REPLACE FUNCTION submit_score(
  p_competition_id uuid, p_round_id uuid, p_dancer_id uuid,
  p_raw_score numeric, p_flagged boolean DEFAULT false,
  p_flag_reason text DEFAULT NULL, p_comment_data jsonb DEFAULT NULL
) RETURNS uuid AS $$
DECLARE v_event_id uuid; v_judge_id uuid; v_score_id uuid;
BEGIN
  SELECT c.event_id INTO v_event_id FROM competitions c WHERE c.id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  SELECT j.id INTO v_judge_id FROM judges j WHERE j.user_id = auth.uid() AND j.event_id = v_event_id;
  IF v_judge_id IS NULL THEN RAISE EXCEPTION 'not a judge for this event'; END IF;
  IF NOT EXISTS (SELECT 1 FROM judge_assignments ja WHERE ja.judge_id = v_judge_id AND ja.competition_id = p_competition_id) THEN
    RAISE EXCEPTION 'not assigned to this competition';
  END IF;
  IF EXISTS (SELECT 1 FROM score_entries se WHERE se.round_id = p_round_id AND se.dancer_id = p_dancer_id AND se.judge_id = v_judge_id AND se.locked_at IS NOT NULL) THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. tabulator_enter_score — organizer only, unlocked
CREATE OR REPLACE FUNCTION tabulator_enter_score(
  p_competition_id uuid, p_round_id uuid, p_dancer_id uuid,
  p_judge_id uuid, p_raw_score numeric,
  p_flagged boolean DEFAULT false, p_flag_reason text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE v_event_id uuid; v_score_id uuid;
BEGIN
  SELECT c.event_id INTO v_event_id FROM competitions c WHERE c.id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  IF EXISTS (SELECT 1 FROM score_entries se WHERE se.round_id = p_round_id AND se.dancer_id = p_dancer_id AND se.judge_id = p_judge_id AND se.locked_at IS NOT NULL) THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. check_in_dancer — organizer or registration_desk
CREATE OR REPLACE FUNCTION check_in_dancer(
  p_event_id uuid, p_dancer_id uuid, p_competitor_number int
) RETURNS uuid AS $$
DECLARE v_roles text[]; v_checkin_id uuid;
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'registration_desk' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or registration_desk role';
  END IF;
  INSERT INTO event_check_ins (event_id, dancer_id, competitor_number, checked_in_at)
  VALUES (p_event_id, p_dancer_id, p_competitor_number, now())
  ON CONFLICT (event_id, dancer_id) DO UPDATE SET competitor_number = EXCLUDED.competitor_number, checked_in_at = now()
  RETURNING id INTO v_checkin_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'event_check_in', v_checkin_id, 'check_in_dancer', jsonb_build_object('dancer_id', p_dancer_id, 'number', p_competitor_number));
  RETURN v_checkin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. fulfill_invitation — server-side only (called by service-role)
CREATE OR REPLACE FUNCTION fulfill_invitation(p_invitation_id uuid, p_user_id uuid)
RETURNS void AS $$
DECLARE v_inv record;
BEGIN
  SELECT * INTO v_inv FROM pending_invitations WHERE id = p_invitation_id AND accepted_at IS NULL;
  IF v_inv IS NULL THEN RETURN; END IF;
  INSERT INTO event_roles (user_id, event_id, role, created_by)
  VALUES (p_user_id, v_inv.event_id, v_inv.role, v_inv.invited_by)
  ON CONFLICT DO NOTHING;
  IF v_inv.judge_id IS NOT NULL THEN
    UPDATE judges SET user_id = p_user_id WHERE id = v_inv.judge_id;
  END IF;
  UPDATE pending_invitations SET accepted_at = now() WHERE id = p_invitation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. transition_competition_status — organizer only
CREATE OR REPLACE FUNCTION transition_competition_status(p_competition_id uuid, p_new_status text)
RETURNS void AS $$
DECLARE v_event_id uuid; v_old_status text;
BEGIN
  SELECT event_id, status INTO v_event_id, v_old_status FROM competitions WHERE id = p_competition_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'competition not found'; END IF;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  UPDATE competitions SET status = p_new_status WHERE id = p_competition_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'transition_status', jsonb_build_object('from', v_old_status, 'to', p_new_status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. confirm_roster — organizer only
CREATE OR REPLACE FUNCTION confirm_roster(p_competition_id uuid)
RETURNS void AS $$
DECLARE v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  UPDATE competitions SET roster_confirmed = true, roster_confirmed_at = now(), roster_confirmed_by = auth.uid()::text WHERE id = p_competition_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'confirm_roster', '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. create_round — organizer only
CREATE OR REPLACE FUNCTION create_round(p_competition_id uuid, p_round_number int, p_round_type text DEFAULT 'normal')
RETURNS uuid AS $$
DECLARE v_event_id uuid; v_round_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_competition_id;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  INSERT INTO rounds (competition_id, round_number, round_type, judge_sign_offs)
  VALUES (p_competition_id, p_round_number, p_round_type, '{}'::jsonb)
  RETURNING id INTO v_round_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'round', v_round_id, 'create_round', jsonb_build_object('competition_id', p_competition_id, 'round_number', p_round_number));
  RETURN v_round_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9. update_heat_snapshot — organizer only
CREATE OR REPLACE FUNCTION update_heat_snapshot(p_round_id uuid, p_snapshot jsonb)
RETURNS void AS $$
DECLARE v_event_id uuid;
BEGIN
  SELECT c.event_id INTO v_event_id FROM rounds r JOIN competitions c ON c.id = r.competition_id WHERE r.id = p_round_id;
  IF NOT 'organizer' = ANY(user_event_role(v_event_id)) THEN RAISE EXCEPTION 'requires organizer role'; END IF;
  UPDATE rounds SET heat_snapshot = p_snapshot WHERE id = p_round_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 10. register_dancer — organizer or registration_desk
CREATE OR REPLACE FUNCTION register_dancer(p_event_id uuid, p_competition_id uuid, p_dancer_id uuid)
RETURNS uuid AS $$
DECLARE v_roles text[]; v_reg_id uuid;
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'registration_desk' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or registration_desk role';
  END IF;
  INSERT INTO registrations (event_id, competition_id, dancer_id, status)
  VALUES (p_event_id, p_competition_id, p_dancer_id, 'registered')
  ON CONFLICT (competition_id, dancer_id) DO NOTHING
  RETURNING id INTO v_reg_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'registration', COALESCE(v_reg_id, gen_random_uuid()), 'register_dancer',
    jsonb_build_object('dancer_id', p_dancer_id, 'competition_id', p_competition_id));
  RETURN v_reg_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 11. update_stage_status — side_stage or organizer
CREATE OR REPLACE FUNCTION update_stage_status(p_event_id uuid, p_dancer_id uuid, p_competition_id uuid, p_status text)
RETURNS void AS $$
DECLARE v_roles text[];
BEGIN
  v_roles := user_event_role(p_event_id);
  IF NOT ('organizer' = ANY(v_roles) OR 'side_stage' = ANY(v_roles)) THEN
    RAISE EXCEPTION 'requires organizer or side_stage role';
  END IF;
  UPDATE registrations SET status = p_status WHERE competition_id = p_competition_id AND dancer_id = p_dancer_id;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'registration', p_competition_id, 'update_stage_status',
    jsonb_build_object('dancer_id', p_dancer_id, 'status', p_status));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
