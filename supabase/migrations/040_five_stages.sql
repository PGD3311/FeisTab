-- 040_five_stages.sql
-- NOT auto-applied: run by hand in the Supabase SQL editor.
-- Re-creates create_event (from 026_write_rpcs.sql) identically, except new
-- events start with Stage 1 to Stage 5 instead of only Stage 1.
-- Existing events are untouched. Safe to re-run (CREATE OR REPLACE).

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
  INSERT INTO stages (event_id, name, display_order)
  SELECT v_event_id, 'Stage ' || n, n FROM generate_series(1, 5) AS n;
  INSERT INTO audit_log (user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'event', v_event_id, 'create_event', jsonb_build_object('name', p_name));
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
