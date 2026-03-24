-- supabase/migrations/028_rls_policies.sql
-- RLS policies + narrow read functions
-- NOTE: Does NOT enable RLS. That's in 029_enable_rls.sql

-------------------------------------------------------
-- NARROW READ FUNCTIONS
-------------------------------------------------------

CREATE OR REPLACE FUNCTION judge_roster(p_comp_id uuid)
RETURNS TABLE (dancer_id uuid, first_name text, last_name text, competitor_number int) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM judge_assignments ja
    JOIN judges j ON j.id = ja.judge_id
    WHERE ja.competition_id = p_comp_id AND j.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not assigned to this competition';
  END IF;
  RETURN QUERY
  SELECT d.id, d.first_name, d.last_name, ec.competitor_number
  FROM registrations r
  JOIN dancers d ON d.id = r.dancer_id
  LEFT JOIN event_check_ins ec ON ec.dancer_id = d.id
    AND ec.event_id = (SELECT event_id FROM competitions WHERE id = p_comp_id)
  WHERE r.competition_id = p_comp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION side_stage_roster(p_comp_id uuid)
RETURNS TABLE (dancer_id uuid, first_name text, last_name text, competitor_number int, registration_status text) AS $$
DECLARE v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM competitions WHERE id = p_comp_id;
  IF NOT ('side_stage' = ANY(user_event_role(v_event_id)) OR 'organizer' = ANY(user_event_role(v_event_id))) THEN
    RAISE EXCEPTION 'requires side_stage or organizer role';
  END IF;
  RETURN QUERY
  SELECT d.id, d.first_name, d.last_name, ec.competitor_number, r.status
  FROM registrations r
  JOIN dancers d ON d.id = r.dancer_id
  LEFT JOIN event_check_ins ec ON ec.dancer_id = d.id AND ec.event_id = v_event_id
  WHERE r.competition_id = p_comp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public_feedback(p_dancer_id uuid, p_event_id uuid)
RETURNS TABLE (comp_name text, final_rank int, judge_name text, comment_data jsonb) AS $$
BEGIN
  RETURN QUERY
  SELECT c.name, res.final_rank, j.first_name || ' ' || j.last_name, se.comment_data
  FROM results res
  JOIN competitions c ON c.id = res.competition_id
  JOIN score_entries se ON se.competition_id = c.id AND se.dancer_id = p_dancer_id
  JOIN judges j ON j.id = se.judge_id
  WHERE res.dancer_id = p_dancer_id AND c.event_id = p_event_id
    AND res.published_at IS NOT NULL AND se.comment_data IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-------------------------------------------------------
-- POLICIES: events
-------------------------------------------------------
CREATE POLICY events_select ON events FOR SELECT
  USING (auth.uid() IS NOT NULL AND array_length(user_event_role(id), 1) > 0);
CREATE POLICY events_insert ON events FOR INSERT
  WITH CHECK (false); -- Only via create_event RPC
CREATE POLICY events_update ON events FOR UPDATE
  USING ('organizer' = ANY(user_event_role(id)));
CREATE POLICY events_delete ON events FOR DELETE
  USING (false);

-------------------------------------------------------
-- POLICIES: dancers (shared table, no event_id)
-------------------------------------------------------
CREATE POLICY dancers_select_role ON dancers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM registrations r JOIN event_roles er ON er.event_id = r.event_id
    WHERE r.dancer_id = dancers.id AND er.user_id = auth.uid()
      AND er.role IN ('organizer', 'registration_desk')
  ));
-- Public: name + number for published results (via public_feedback function, no raw table access needed)
CREATE POLICY dancers_insert ON dancers FOR INSERT WITH CHECK (false); -- Via RPC
CREATE POLICY dancers_update ON dancers FOR UPDATE USING (false); -- Via RPC
CREATE POLICY dancers_delete ON dancers FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: judges
-------------------------------------------------------
CREATE POLICY judges_select ON judges FOR SELECT
  USING (auth.uid() IS NOT NULL AND array_length(user_event_role(event_id), 1) > 0);
CREATE POLICY judges_insert ON judges FOR INSERT
  WITH CHECK ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY judges_update ON judges FOR UPDATE
  USING ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY judges_delete ON judges FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: competitions
-------------------------------------------------------
CREATE POLICY competitions_select ON competitions FOR SELECT
  USING (auth.uid() IS NOT NULL AND array_length(user_event_role(event_id), 1) > 0);
CREATE POLICY competitions_insert ON competitions FOR INSERT
  WITH CHECK ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY competitions_update ON competitions FOR UPDATE
  USING ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY competitions_delete ON competitions FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: registrations
-------------------------------------------------------
CREATE POLICY registrations_select_org ON registrations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM event_roles er WHERE er.event_id = registrations.event_id
      AND er.user_id = auth.uid() AND er.role IN ('organizer', 'registration_desk')
  ));
CREATE POLICY registrations_insert ON registrations FOR INSERT WITH CHECK (false); -- Via RPC
CREATE POLICY registrations_update ON registrations FOR UPDATE USING (false); -- Via RPC
CREATE POLICY registrations_delete ON registrations FOR DELETE
  USING ('organizer' = ANY(user_event_role(event_id)));

-------------------------------------------------------
-- POLICIES: event_check_ins
-------------------------------------------------------
CREATE POLICY event_check_ins_select ON event_check_ins FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM event_roles er WHERE er.event_id = event_check_ins.event_id
      AND er.user_id = auth.uid() AND er.role IN ('organizer', 'registration_desk')
  ));
CREATE POLICY event_check_ins_insert ON event_check_ins FOR INSERT WITH CHECK (false); -- Via RPC
CREATE POLICY event_check_ins_update ON event_check_ins FOR UPDATE USING (false); -- Via RPC
CREATE POLICY event_check_ins_delete ON event_check_ins FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: rounds
-------------------------------------------------------
CREATE POLICY rounds_select ON rounds FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c JOIN event_roles er ON er.event_id = c.event_id
    WHERE c.id = rounds.competition_id AND er.user_id = auth.uid()
  ));
CREATE POLICY rounds_insert ON rounds FOR INSERT WITH CHECK (false); -- Via RPC
CREATE POLICY rounds_update ON rounds FOR UPDATE USING (false); -- Via RPC
CREATE POLICY rounds_delete ON rounds FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: score_entries
-------------------------------------------------------
CREATE POLICY score_entries_select_org ON score_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c JOIN event_roles er ON er.event_id = c.event_id
    WHERE c.id = score_entries.competition_id AND er.user_id = auth.uid() AND er.role = 'organizer'
  ));
CREATE POLICY score_entries_select_judge ON score_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM judges j WHERE j.id = score_entries.judge_id AND j.user_id = auth.uid()
  ));
CREATE POLICY score_entries_insert ON score_entries FOR INSERT WITH CHECK (false); -- Via RPC
CREATE POLICY score_entries_update ON score_entries FOR UPDATE USING (false); -- Via RPC
CREATE POLICY score_entries_delete ON score_entries FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: stages
-------------------------------------------------------
CREATE POLICY stages_select ON stages FOR SELECT
  USING (auth.uid() IS NOT NULL AND array_length(user_event_role(event_id), 1) > 0);
CREATE POLICY stages_insert ON stages FOR INSERT
  WITH CHECK ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY stages_update ON stages FOR UPDATE
  USING ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY stages_delete ON stages FOR DELETE
  USING ('organizer' = ANY(user_event_role(event_id)));

-------------------------------------------------------
-- POLICIES: rule_sets
-------------------------------------------------------
CREATE POLICY rule_sets_select ON rule_sets FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY rule_sets_insert ON rule_sets FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL); -- Seeded data, organizer can add
CREATE POLICY rule_sets_update ON rule_sets FOR UPDATE
  USING (auth.uid() IS NOT NULL);
CREATE POLICY rule_sets_delete ON rule_sets FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: results
-------------------------------------------------------
CREATE POLICY results_select_org ON results FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c JOIN event_roles er ON er.event_id = c.event_id
    WHERE c.id = results.competition_id AND er.user_id = auth.uid() AND er.role = 'organizer'
  ));
CREATE POLICY results_select_public ON results FOR SELECT
  USING (published_at IS NOT NULL); -- Public access for published results
CREATE POLICY results_insert ON results FOR INSERT WITH CHECK (false); -- Via RPC
CREATE POLICY results_update ON results FOR UPDATE USING (false); -- Via RPC
CREATE POLICY results_delete ON results FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: recalls
-------------------------------------------------------
CREATE POLICY recalls_select ON recalls FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c JOIN event_roles er ON er.event_id = c.event_id
    WHERE c.id = recalls.competition_id AND er.user_id = auth.uid() AND er.role = 'organizer'
  ));
CREATE POLICY recalls_insert ON recalls FOR INSERT WITH CHECK (false); -- Via RPC
CREATE POLICY recalls_delete ON recalls FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: event_roles
-------------------------------------------------------
CREATE POLICY event_roles_select_org ON event_roles FOR SELECT
  USING ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY event_roles_select_own ON event_roles FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY event_roles_insert ON event_roles FOR INSERT
  WITH CHECK ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY event_roles_update ON event_roles FOR UPDATE
  USING ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY event_roles_delete ON event_roles FOR DELETE
  USING ('organizer' = ANY(user_event_role(event_id)));

-------------------------------------------------------
-- POLICIES: judge_assignments
-------------------------------------------------------
CREATE POLICY judge_assignments_select_org ON judge_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM competitions c JOIN event_roles er ON er.event_id = c.event_id
    WHERE c.id = judge_assignments.competition_id AND er.user_id = auth.uid() AND er.role = 'organizer'
  ));
CREATE POLICY judge_assignments_select_own ON judge_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM judges j WHERE j.id = judge_assignments.judge_id AND j.user_id = auth.uid()
  ));
CREATE POLICY judge_assignments_insert ON judge_assignments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = judge_assignments.competition_id
      AND 'organizer' = ANY(user_event_role(c.event_id))
  ));
CREATE POLICY judge_assignments_update ON judge_assignments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = judge_assignments.competition_id
      AND 'organizer' = ANY(user_event_role(c.event_id))
  ));
CREATE POLICY judge_assignments_delete ON judge_assignments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM competitions c WHERE c.id = judge_assignments.competition_id
      AND 'organizer' = ANY(user_event_role(c.event_id))
  ));

-------------------------------------------------------
-- POLICIES: audit_log
-------------------------------------------------------
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (auth.uid() IS NOT NULL); -- Organizer-only enforced at app level for now
CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (false); -- Trigger/RPC only
CREATE POLICY audit_log_update ON audit_log FOR UPDATE USING (false);
CREATE POLICY audit_log_delete ON audit_log FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: status_changes
-------------------------------------------------------
CREATE POLICY status_changes_select ON status_changes FOR SELECT
  USING (auth.uid() IS NOT NULL); -- Organizer-only enforced at app level for now
CREATE POLICY status_changes_insert ON status_changes FOR INSERT WITH CHECK (false); -- Trigger only
CREATE POLICY status_changes_update ON status_changes FOR UPDATE USING (false);
CREATE POLICY status_changes_delete ON status_changes FOR DELETE USING (false);

-------------------------------------------------------
-- POLICIES: pending_invitations
-------------------------------------------------------
CREATE POLICY pending_invitations_select ON pending_invitations FOR SELECT
  USING ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY pending_invitations_insert ON pending_invitations FOR INSERT
  WITH CHECK ('organizer' = ANY(user_event_role(event_id)));
CREATE POLICY pending_invitations_update ON pending_invitations FOR UPDATE
  USING (false); -- Only via fulfill_invitation RPC (SECURITY DEFINER)
CREATE POLICY pending_invitations_delete ON pending_invitations FOR DELETE
  USING ('organizer' = ANY(user_event_role(event_id)));
