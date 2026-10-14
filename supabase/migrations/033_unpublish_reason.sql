-- 033_unpublish_reason.sql
-- The unpublish dialog asks for a reason (and a note when the reason is "other"),
-- but unpublish_results never took them, so they were thrown away. Record both in
-- the audit_log entry, the same way unlock_for_correction does.
-- Role check, expected-status guard and state changes are unchanged from 025.
-- p_reason defaults to NULL so an app build that predates this migration can still
-- unpublish; the dialog itself requires a reason.

DROP FUNCTION IF EXISTS unpublish_results(uuid, text, text);

CREATE FUNCTION unpublish_results(
  p_competition_id uuid,
  p_unpublished_by text,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
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
  IF p_reason = 'other' AND COALESCE(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'a note is required when the reason is "other"';
  END IF;

  UPDATE competitions
  SET status = 'complete_unpublished', unpublished_by = p_unpublished_by, unpublished_at = v_now,
      approved_by = NULL, approved_at = NULL
  WHERE id = p_competition_id AND status = p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competition not in expected status (%)', p_expected_status; END IF;

  UPDATE results SET published_at = NULL WHERE competition_id = p_competition_id;

  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'competition', p_competition_id, 'unpublish_results',
    jsonb_build_object('unpublished_by', p_unpublished_by, 'reason', p_reason,
      'note', NULLIF(btrim(p_note), '')));
END;
$$;

-- A new function gets PUBLIC execute by default; match 032's grants (login required)
REVOKE EXECUTE ON FUNCTION unpublish_results(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION unpublish_results(uuid, text, text, text, text) TO authenticated;
