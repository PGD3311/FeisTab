INSERT INTO events (id, name, start_date, end_date, location, status, registration_code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Spring Feis 2026', '2026-03-15', '2026-03-15', 'Boston Convention Center', 'active', 'SPRING26');

INSERT INTO judges (id, event_id, first_name, last_name, access_code) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Siobhan', 'Murphy', 'MURPHY-1234'),
  ('aaaa2222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Padraig', 'O''Brien', 'OBRIEN-5678');

INSERT INTO dancers (id, first_name, last_name, school_name) VALUES
  ('dddd1111-1111-1111-1111-111111111111', 'Aoife', 'Kelly', 'Scoil Rince Ni Bhriain'),
  ('dddd2222-2222-2222-2222-222222222222', 'Ciara', 'Walsh', 'McGrath Academy'),
  ('dddd3333-3333-3333-3333-333333333333', 'Niamh', 'O''Sullivan', 'Scoil Rince Ni Bhriain'),
  ('dddd4444-4444-4444-4444-444444444444', 'Saoirse', 'Byrne', 'Claddagh School of Dance'),
  ('dddd5555-5555-5555-5555-555555555555', 'Roisin', 'Doyle', 'McGrath Academy'),
  ('dddd6666-6666-6666-6666-666666666666', 'Maeve', 'Fitzgerald', 'Claddagh School of Dance'),
  ('dddd7777-7777-7777-7777-777777777777', 'Orla', 'McCarthy', 'Scoil Rince Ni Bhriain'),
  ('dddd8888-8888-8888-8888-888888888888', 'Caoimhe', 'Ryan', 'McGrath Academy'),
  ('dddd9999-9999-9999-9999-999999999999', 'Aisling', 'Brennan', 'Claddagh School of Dance'),
  ('ddddaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fionnuala', 'Gallagher', 'Scoil Rince Ni Bhriain');

INSERT INTO competitions (id, event_id, code, name, age_group, level, status, ruleset_id) VALUES
  ('cccc1111-1111-1111-1111-cccc11111111', '11111111-1111-1111-1111-111111111111', 'B101', 'Beginner Reel', 'U10', 'Beginner', 'in_progress', (SELECT id FROM rule_sets LIMIT 1)),
  ('cccc2222-2222-2222-2222-cccc22222222', '11111111-1111-1111-1111-111111111111', 'N201', 'Novice Jig', 'U12', 'Novice', 'in_progress', (SELECT id FROM rule_sets LIMIT 1)),
  ('cccc3333-3333-3333-3333-cccc33333333', '11111111-1111-1111-1111-111111111111', 'O301', 'Open Hornpipe', 'U14', 'Open', 'imported', (SELECT id FROM rule_sets LIMIT 1));

INSERT INTO rounds (id, competition_id, round_number, round_type, status) VALUES
  ('eeee1111-1111-1111-1111-eeee11111111', 'cccc1111-1111-1111-1111-cccc11111111', 1, 'standard', 'in_progress'),
  ('eeee2222-2222-2222-2222-eeee22222222', 'cccc2222-2222-2222-2222-cccc22222222', 1, 'standard', 'in_progress'),
  ('eeee3333-3333-3333-3333-eeee33333333', 'cccc3333-3333-3333-3333-cccc33333333', 1, 'standard', 'pending');

INSERT INTO registrations (event_id, dancer_id, competition_id, competitor_number, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', 'cccc1111-1111-1111-1111-cccc11111111', '101', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd2222-2222-2222-2222-222222222222', 'cccc1111-1111-1111-1111-cccc11111111', '102', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd3333-3333-3333-3333-333333333333', 'cccc1111-1111-1111-1111-cccc11111111', '103', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd4444-4444-4444-4444-444444444444', 'cccc1111-1111-1111-1111-cccc11111111', '104', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd5555-5555-5555-5555-555555555555', 'cccc1111-1111-1111-1111-cccc11111111', '105', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd3333-3333-3333-3333-333333333333', 'cccc2222-2222-2222-2222-cccc22222222', '103', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd6666-6666-6666-6666-666666666666', 'cccc2222-2222-2222-2222-cccc22222222', '106', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd7777-7777-7777-7777-777777777777', 'cccc2222-2222-2222-2222-cccc22222222', '107', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd8888-8888-8888-8888-888888888888', 'cccc2222-2222-2222-2222-cccc22222222', '108', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd9999-9999-9999-9999-999999999999', 'cccc2222-2222-2222-2222-cccc22222222', '109', 'present'),
  ('11111111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', 'cccc3333-3333-3333-3333-cccc33333333', '101', 'registered'),
  ('11111111-1111-1111-1111-111111111111', 'dddd6666-6666-6666-6666-666666666666', 'cccc3333-3333-3333-3333-cccc33333333', '106', 'registered'),
  ('11111111-1111-1111-1111-111111111111', 'ddddaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccc3333-3333-3333-3333-cccc33333333', '110', 'registered'),
  ('11111111-1111-1111-1111-111111111111', 'dddd9999-9999-9999-9999-999999999999', 'cccc3333-3333-3333-3333-cccc33333333', '109', 'registered');

-- Event check-ins (source of truth for competitor numbers + arrival state)
INSERT INTO event_check_ins (event_id, dancer_id, competitor_number, checked_in_by) VALUES
  ('11111111-1111-1111-1111-111111111111', 'dddd1111-1111-1111-1111-111111111111', '101', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd2222-2222-2222-2222-222222222222', '102', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd3333-3333-3333-3333-333333333333', '103', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd4444-4444-4444-4444-444444444444', '104', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd5555-5555-5555-5555-555555555555', '105', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd6666-6666-6666-6666-666666666666', '106', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd7777-7777-7777-7777-777777777777', '107', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd8888-8888-8888-8888-888888888888', '108', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'dddd9999-9999-9999-9999-999999999999', '109', 'seed'),
  ('11111111-1111-1111-1111-111111111111', 'ddddaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '110', 'seed');

INSERT INTO score_entries (round_id, competition_id, dancer_id, judge_id, raw_score) VALUES
  ('eeee1111-1111-1111-1111-eeee11111111', 'cccc1111-1111-1111-1111-cccc11111111', 'dddd1111-1111-1111-1111-111111111111', 'aaaa1111-1111-1111-1111-111111111111', 82.5),
  ('eeee1111-1111-1111-1111-eeee11111111', 'cccc1111-1111-1111-1111-cccc11111111', 'dddd2222-2222-2222-2222-222222222222', 'aaaa1111-1111-1111-1111-111111111111', 78.0),
  ('eeee1111-1111-1111-1111-eeee11111111', 'cccc1111-1111-1111-1111-cccc11111111', 'dddd3333-3333-3333-3333-333333333333', 'aaaa1111-1111-1111-1111-111111111111', 85.5),
  ('eeee1111-1111-1111-1111-eeee11111111', 'cccc1111-1111-1111-1111-cccc11111111', 'dddd4444-4444-4444-4444-444444444444', 'aaaa1111-1111-1111-1111-111111111111', 71.0),
  ('eeee1111-1111-1111-1111-eeee11111111', 'cccc1111-1111-1111-1111-cccc11111111', 'dddd5555-5555-5555-5555-555555555555', 'aaaa1111-1111-1111-1111-111111111111', 88.0);

INSERT INTO stages (event_id, name, display_order) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Main Stage', 1),
  ('11111111-1111-1111-1111-111111111111', 'Stage B', 2);

-- Update dancers with teacher names
UPDATE dancers SET teacher_name = 'Colm Murphy' WHERE school_name = 'Scoil Rince Ni Bhriain';
UPDATE dancers SET teacher_name = 'Fiona McGrath' WHERE school_name = 'McGrath Academy';
UPDATE dancers SET teacher_name = 'Sean Claddagh' WHERE school_name = 'Claddagh School of Dance';
