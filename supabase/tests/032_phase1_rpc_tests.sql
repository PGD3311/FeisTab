-- 032_phase1_rpc_tests.sql
-- Role-by-role tests for migration 032. Run the whole file as ONE transaction
-- (Supabase MCP apply_migration, or the SQL editor). It never leaves data behind:
-- the final statement always raises, which rolls the transaction back (and
-- apply_migration records nothing). Read the result from that error message:
-- "PHASE1 TESTS: <passed>/<total> passed; FAILED: ...".

CREATE TEMP TABLE t_results (n serial, name text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON t_results TO PUBLIC;
GRANT USAGE ON SEQUENCE t_results_n_seq TO PUBLIC;
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT ON t_ids TO PUBLIC;

CREATE FUNCTION pg_temp.id(p_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t_ids WHERE k = p_k $$;
CREATE FUNCTION pg_temp.as_user(p_k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM t_ids WHERE k = p_k), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('role', 'anon', true);
END $$;
CREATE FUNCTION pg_temp.as_admin() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE FUNCTION pg_temp.ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t_results (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail)
$$;

-- ---------- Fixtures (as admin) ----------
DO $$
DECLARE k text; v_rs uuid; v_e1 uuid; v_e2 uuid; v_c1 uuid; v_c2 uuid;
BEGIN
  FOREACH k IN ARRAY ARRAY['org1', 'side1', 'desk1', 'judge1', 'judge2', 'stranger'] LOOP
    INSERT INTO t_ids VALUES (k, gen_random_uuid());
    INSERT INTO auth.users (id, email, aud, role)
    VALUES (pg_temp.id(k), k || '-' || substr(gen_random_uuid()::text, 1, 8) || '@phase1.test', 'authenticated', 'authenticated');
  END LOOP;

  SELECT id INTO v_rs FROM rule_sets WHERE name = 'Default - Irish Points' LIMIT 1;
  INSERT INTO events (name, start_date, status, registration_code, created_by)
  VALUES ('Phase1 Test Feis', current_date, 'draft', 'T1' || substr(md5(random()::text), 1, 4), pg_temp.id('org1')) RETURNING id INTO v_e1;
  INSERT INTO events (name, start_date, status, registration_code, created_by)
  VALUES ('Other Feis', current_date, 'draft', 'T2' || substr(md5(random()::text), 1, 4), pg_temp.id('stranger')) RETURNING id INTO v_e2;
  INSERT INTO t_ids VALUES ('e1', v_e1), ('e2', v_e2);

  INSERT INTO event_roles (user_id, event_id, role) VALUES
    (pg_temp.id('org1'), v_e1, 'organizer'), (pg_temp.id('side1'), v_e1, 'side_stage'),
    (pg_temp.id('desk1'), v_e1, 'registration_desk'), (pg_temp.id('judge1'), v_e1, 'judge'),
    (pg_temp.id('judge2'), v_e1, 'judge'), (pg_temp.id('stranger'), v_e2, 'organizer');

  WITH x AS (INSERT INTO judges (event_id, first_name, last_name, user_id)
    VALUES (v_e1, 'Judge', 'One', pg_temp.id('judge1')) RETURNING id) INSERT INTO t_ids SELECT 'j1', id FROM x;
  WITH x AS (INSERT INTO judges (event_id, first_name, last_name, user_id)
    VALUES (v_e1, 'Judge', 'Two', pg_temp.id('judge2')) RETURNING id) INSERT INTO t_ids SELECT 'j2', id FROM x;
  WITH x AS (INSERT INTO judges (event_id, first_name, last_name)
    VALUES (v_e1, 'Judge', 'Unused') RETURNING id) INSERT INTO t_ids SELECT 'j3', id FROM x;

  INSERT INTO competitions (event_id, code, name, status, ruleset_id)
  VALUES (v_e1, 'P1', 'Phase1 U10 Reel', 'imported', v_rs) RETURNING id INTO v_c1;
  INSERT INTO competitions (event_id, code, name, status, ruleset_id)
  VALUES (v_e2, 'X1', 'Other comp', 'imported', v_rs) RETURNING id INTO v_c2;
  INSERT INTO t_ids VALUES ('c1', v_c1), ('c2', v_c2);
  INSERT INTO judge_assignments (judge_id, competition_id) VALUES (pg_temp.id('j1'), v_c1), (pg_temp.id('j2'), v_c1);

  FOREACH k IN ARRAY ARRAY['d1', 'd2', 'd3'] LOOP
    WITH x AS (INSERT INTO dancers (first_name, last_name, school_name, date_of_birth)
      VALUES ('Test' || k, 'Phase1' || substr(gen_random_uuid()::text, 1, 6), 'Test School', '2016-05-01') RETURNING id) INSERT INTO t_ids SELECT k, id FROM x;
    WITH x AS (INSERT INTO registrations (event_id, dancer_id, competition_id, status)
      VALUES (v_e1, pg_temp.id(k), v_c1, 'present') RETURNING id) INSERT INTO t_ids SELECT 'r' || substr(k, 2), id FROM x;
  END LOOP;
END $$;

-- ---------- Holes from the audit: a logged-in stranger from another event ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM set_registration_status(pg_temp.id('r1'), 'scratched');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('stranger cannot scratch in another event', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('stranger cannot scratch in another event', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM register_dancer(pg_temp.id('e2'), pg_temp.id('c1'), pg_temp.id('d1'));
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('register_dancer rejects competition from other event', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('register_dancer rejects competition from other event', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM check_in_dancer(pg_temp.id('e2'), pg_temp.id('d1'), 5);
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('check_in_dancer rejects dancer not in event', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('check_in_dancer rejects dancer not in event', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  INSERT INTO pending_invitations (email, event_id, role, judge_id, invited_by)
  VALUES ('x@phase1.test', pg_temp.id('e2'), 'judge', pg_temp.id('j1'), pg_temp.id('stranger'));
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('invitation cannot target judge from other event', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('invitation cannot target judge from other event', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.ok('anon cannot execute fulfill_invitation',
    NOT has_function_privilege('anon', 'fulfill_invitation(uuid,uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('authenticated cannot execute fulfill_invitation',
    NOT has_function_privilege('authenticated', 'fulfill_invitation(uuid,uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('anon cannot execute submit_score',
    NOT has_function_privilege('anon', 'submit_score(uuid,uuid,uuid,numeric,boolean,text,jsonb)', 'EXECUTE'));
  PERFORM pg_temp.ok('anon can execute public_event_results',
    has_function_privilege('anon', 'public_event_results(uuid)', 'EXECUTE'));
END $$;

DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('stranger');
  UPDATE rule_sets SET config = config WHERE name = 'Default - Irish Points';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('logged-in user cannot edit scoring rules', v_n = 0, v_n || ' rows');
END $$;

-- ---------- Side-stage ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('side1');
  PERFORM confirm_roster(pg_temp.id('c1'));
  PERFORM transition_competition_status(pg_temp.id('c1'), 'ready_for_day_of');
  PERFORM transition_competition_status(pg_temp.id('c1'), 'released_to_judge', 'ready_for_day_of');
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('side-stage confirms roster and sends to judge',
    (SELECT roster_confirmed_at IS NOT NULL AND status = 'released_to_judge' FROM competitions WHERE id = pg_temp.id('c1')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('side-stage confirms roster and sends to judge', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('side1');
  PERFORM transition_competition_status(pg_temp.id('c1'), 'in_progress');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('side-stage cannot start scoring', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('side-stage cannot start scoring', true, SQLERRM); END $$;

-- ---------- Judge starts (was organizer-only, so judges' Start failed) ----------
DO $$ DECLARE v_r1 uuid; v_r2 uuid; BEGIN
  PERFORM pg_temp.as_user('judge1');
  PERFORM transition_competition_status(pg_temp.id('c1'), 'in_progress');
  v_r1 := create_round(pg_temp.id('c1'), 1, 'standard');
  PERFORM update_heat_snapshot(v_r1, jsonb_build_object('group_size', 2, 'generated_at', now(), 'heats', jsonb_build_array(
    jsonb_build_object('heat_number', 1, 'slots', jsonb_build_array(
      jsonb_build_object('dancer_id', pg_temp.id('d1'), 'competitor_number', '1', 'status', 'active'),
      jsonb_build_object('dancer_id', pg_temp.id('d2'), 'competitor_number', '2', 'status', 'active'))),
    jsonb_build_object('heat_number', 2, 'slots', jsonb_build_array(
      jsonb_build_object('dancer_id', pg_temp.id('d3'), 'competitor_number', '3', 'status', 'active'))))));
  PERFORM pg_temp.as_user('judge2');
  v_r2 := create_round(pg_temp.id('c1'), 1, 'standard');
  PERFORM pg_temp.as_admin();
  INSERT INTO t_ids VALUES ('round1', v_r1);
  PERFORM pg_temp.ok('judge starts competition; second judge gets same round', v_r1 = v_r2
    AND (SELECT status FROM competitions WHERE id = pg_temp.id('c1')) = 'in_progress');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('judge starts competition; second judge gets same round', false, SQLERRM); END $$;

DO $$ DECLARE v_n int; BEGIN
  PERFORM pg_temp.as_user('judge1');
  SELECT count(*) INTO v_n FROM registrations WHERE competition_id = pg_temp.id('c1');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('assigned judge can read registration statuses', v_n = 3, v_n || ' rows');
END $$;

-- Scratch mid-competition reaches the judge's heat list
DO $$ BEGIN
  PERFORM pg_temp.as_user('side1');
  PERFORM set_registration_status(pg_temp.id('r3'), 'scratched');
  PERFORM set_registration_status(pg_temp.id('r2'), 'medical');
  PERFORM set_registration_status(pg_temp.id('r2'), 'present');
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('side-stage scratch saves and patches heat snapshot',
    (SELECT status FROM registrations WHERE id = pg_temp.id('r3')) = 'scratched'
    AND (SELECT heat_snapshot #>> '{heats,1,slots,0,status}' FROM rounds WHERE id = pg_temp.id('round1')) = 'scratched'
    AND (SELECT heat_snapshot #>> '{heats,0,slots,0,status}' FROM rounds WHERE id = pg_temp.id('round1')) = 'active');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('side-stage scratch saves and patches heat snapshot', false, SQLERRM); END $$;

-- ---------- Scoring and sign-off ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('judge1');
  PERFORM submit_score(pg_temp.id('c1'), pg_temp.id('round1'), pg_temp.id('d1'), 80);
  PERFORM submit_score(pg_temp.id('c1'), pg_temp.id('round1'), pg_temp.id('d2'), 75);
  PERFORM pg_temp.as_user('judge2');
  PERFORM submit_score(pg_temp.id('c1'), pg_temp.id('round1'), pg_temp.id('d1'), 70);
  PERFORM submit_score(pg_temp.id('c1'), pg_temp.id('round1'), pg_temp.id('d2'), 78);
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('assigned judges submit scores', true);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('assigned judges submit scores', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM submit_score(pg_temp.id('c1'), pg_temp.id('round1'), pg_temp.id('d1'), 99);
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('stranger cannot submit a score', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('stranger cannot submit a score', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM tabulator_enter_score(pg_temp.id('c2'), pg_temp.id('round1'), pg_temp.id('d1'), pg_temp.id('j1'), 99);
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('tabulator_enter_score rejects round from another competition', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('tabulator_enter_score rejects round from another competition', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('judge1');
  PERFORM sign_off_judge(pg_temp.id('round1'), pg_temp.id('j1'), pg_temp.id('c1'));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('first sign-off locks scores, status stays in_progress',
    (SELECT status FROM competitions WHERE id = pg_temp.id('c1')) = 'in_progress'
    AND NOT EXISTS (SELECT 1 FROM score_entries WHERE round_id = pg_temp.id('round1') AND judge_id = pg_temp.id('j1') AND locked_at IS NULL));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('first sign-off locks scores, status stays in_progress', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('judge1');
  PERFORM submit_score(pg_temp.id('c1'), pg_temp.id('round1'), pg_temp.id('d1'), 90);
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('signed-off judge cannot change a score', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('signed-off judge cannot change a score', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('judge1');
  PERFORM sign_off_judge(pg_temp.id('round1'), pg_temp.id('j1'), pg_temp.id('c1'), 'remove');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('judge cannot reopen own sign-off', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('judge cannot reopen own sign-off', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('judge2');
  PERFORM sign_off_judge(pg_temp.id('round1'), pg_temp.id('j2'), pg_temp.id('c1'));
  PERFORM sign_off_judge(pg_temp.id('round1'), pg_temp.id('j2'), pg_temp.id('c1'));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('last sign-off advances to ready_to_tabulate; double tap is harmless',
    (SELECT status FROM competitions WHERE id = pg_temp.id('c1')) = 'ready_to_tabulate');
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('last sign-off advances to ready_to_tabulate; double tap is harmless', false, SQLERRM); END $$;

-- ---------- Tabulate, unlock for correction ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('org1');
  PERFORM approve_tabulation(pg_temp.id('c1'), jsonb_build_array(
    jsonb_build_object('dancer_id', pg_temp.id('d1'), 'final_rank', 1, 'display_place', '1st', 'calculated_payload', '{}'::jsonb),
    jsonb_build_object('dancer_id', pg_temp.id('d2'), 'final_rank', 2, 'display_place', '2nd', 'calculated_payload', '{}'::jsonb)));
  PERFORM unlock_for_correction(pg_temp.id('c1'), pg_temp.id('j1'), 'wrong_score');
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('unlock clears stale results, reopens judge, records reason',
    NOT EXISTS (SELECT 1 FROM results WHERE competition_id = pg_temp.id('c1'))
    AND (SELECT status FROM competitions WHERE id = pg_temp.id('c1')) = 'awaiting_scores'
    AND NOT (SELECT judge_sign_offs ? pg_temp.id('j1')::text FROM rounds WHERE id = pg_temp.id('round1'))
    AND EXISTS (SELECT 1 FROM audit_log WHERE action = 'unlock_for_correction' AND entity_id = pg_temp.id('c1')
                AND after_data->>'reason' = 'wrong_score'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('unlock clears stale results, reopens judge, records reason', false, SQLERRM); END $$;

DO $$ BEGIN
  UPDATE competitions SET status = 'published' WHERE id = pg_temp.id('c1');
  PERFORM pg_temp.ok('database rejects invalid status jump (awaiting_scores -> published)', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('database rejects invalid status jump (awaiting_scores -> published)', true, SQLERRM); END $$;

-- Re-sign, tabulate, publish; anonymous visitor sees results
DO $$ DECLARE v jsonb; BEGIN
  PERFORM pg_temp.as_user('judge1');
  PERFORM submit_score(pg_temp.id('c1'), pg_temp.id('round1'), pg_temp.id('d1'), 85);
  PERFORM sign_off_judge(pg_temp.id('round1'), pg_temp.id('j1'), pg_temp.id('c1'));
  PERFORM pg_temp.as_user('org1');
  PERFORM approve_tabulation(pg_temp.id('c1'), jsonb_build_array(
    jsonb_build_object('dancer_id', pg_temp.id('d1'), 'final_rank', 1, 'display_place', '1st', 'calculated_payload', '{}'::jsonb),
    jsonb_build_object('dancer_id', pg_temp.id('d2'), 'final_rank', 2, 'display_place', '2nd', 'calculated_payload', '{}'::jsonb)));
  PERFORM publish_results(pg_temp.id('c1'), 'Org One');
  PERFORM pg_temp.as_anon();
  v := public_event_results(pg_temp.id('e1'));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('anonymous visitor gets published results without DOB',
    jsonb_array_length(v->'competitions') = 1
    AND jsonb_array_length(v #> '{competitions,0,results}') = 2
    AND NOT (v::text LIKE '%date_of_birth%') AND NOT (v::text LIKE '%2016-05-01%'), left(v::text, 200));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('anonymous visitor gets published results without DOB', false, SQLERRM); END $$;

DO $$ DECLARE v jsonb; BEGIN
  PERFORM pg_temp.as_anon();
  v := public_feedback_header(pg_temp.id('e1'), pg_temp.id('d3'));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('feedback header hidden for dancer with no published result', v IS NULL);
END $$;

-- ---------- Registration desk ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('desk1');
  PERFORM check_in_dancer(pg_temp.id('e1'), pg_temp.id('d3'), 103);
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('check-in syncs number to registration',
    (SELECT competitor_number FROM registrations WHERE id = pg_temp.id('r3')) = '103');
  PERFORM pg_temp.as_user('desk1');
  PERFORM undo_check_in(pg_temp.id('e1'), pg_temp.id('d3'));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('undo check-in removes it and clears the number',
    NOT EXISTS (SELECT 1 FROM event_check_ins WHERE event_id = pg_temp.id('e1') AND dancer_id = pg_temp.id('d3'))
    AND (SELECT competitor_number FROM registrations WHERE id = pg_temp.id('r3')) IS NULL);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('registration desk check-in / undo', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('desk1');
  PERFORM check_in_dancer(pg_temp.id('e1'), pg_temp.id('d1'), 101);
  PERFORM undo_check_in(pg_temp.id('e1'), pg_temp.id('d1'));
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('cannot undo check-in for a dancer with scores', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('cannot undo check-in for a dancer with scores', true, SQLERRM); END $$;

-- ---------- Import, judge removal, event deletion ----------
DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM import_event_rows(pg_temp.id('e1'), '[{"first_name":"A","last_name":"B","competition_code":"Z"}]');
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('stranger cannot import into another event', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('stranger cannot import into another event', true, SQLERRM); END $$;

DO $$ DECLARE v jsonb; BEGIN
  PERFORM pg_temp.as_user('org1');
  v := import_event_rows(pg_temp.id('e1'), jsonb_build_array(
    jsonb_build_object('first_name', 'Imported', 'last_name', 'Dancer' || substr(gen_random_uuid()::text, 1, 6),
      'school_name', 'Test School', 'competition_code', 'P2', 'competition_name', 'Phase1 U12 Jig',
      'age_group', 'U12', 'level', 'Novice', 'competitor_number', '201'),
    jsonb_build_object('first_name', 'Numbered', 'last_name', 'Twice' || substr(gen_random_uuid()::text, 1, 6),
      'competition_code', 'P2', 'competitor_number', '202'),
    jsonb_build_object('first_name', 'Numbered', 'last_name', 'Twice' || substr(gen_random_uuid()::text, 1, 6),
      'competition_code', 'P2', 'competitor_number', '203')));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('organizer import creates competition, round, registrations, numbers',
    (v->>'competitions_created')::int = 1 AND (v->>'registrations')::int = 3 AND (v->>'check_ins')::int = 3
    AND EXISTS (SELECT 1 FROM rounds r JOIN competitions c ON c.id = r.competition_id
                WHERE c.event_id = pg_temp.id('e1') AND c.code = 'P2' AND r.round_number = 1), v::text);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('organizer import creates competition, round, registrations, numbers', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('org1');
  PERFORM remove_judge(pg_temp.id('j1'));
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('cannot remove a judge who has scores', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('cannot remove a judge who has scores', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('org1');
  PERFORM remove_judge(pg_temp.id('j3'));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('organizer removes unused judge', NOT EXISTS (SELECT 1 FROM judges WHERE id = pg_temp.id('j3')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('organizer removes unused judge', false, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('org1');
  PERFORM delete_event(pg_temp.id('e1'));
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('event with published results cannot be deleted', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('event with published results cannot be deleted', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM delete_event(pg_temp.id('e1'));
  PERFORM pg_temp.as_admin(); PERFORM pg_temp.ok('stranger cannot delete another event', false);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('stranger cannot delete another event', true, SQLERRM); END $$;

DO $$ BEGIN
  PERFORM pg_temp.as_user('stranger');
  PERFORM delete_event(pg_temp.id('e2'));
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.ok('organizer deletes own unpublished event', NOT EXISTS (SELECT 1 FROM events WHERE id = pg_temp.id('e2')));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.ok('organizer deletes own unpublished event', false, SQLERRM); END $$;

-- ---------- Report (always raises → everything above rolls back) ----------
DO $$
DECLARE v_pass int; v_total int; v_failed text;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) INTO v_pass, v_total FROM t_results;
  SELECT string_agg(name || COALESCE(' [' || detail || ']', ''), ' | ' ORDER BY n) INTO v_failed FROM t_results WHERE NOT ok;
  RAISE EXCEPTION 'PHASE1 TESTS: %/% passed; FAILED: %', v_pass, v_total, COALESCE(v_failed, 'none');
END $$;
