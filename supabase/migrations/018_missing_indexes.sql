-- Add missing indexes on foreign key columns and commonly queried columns
-- These prevent full table scans on JOINs and WHERE clauses

-- Foreign keys missing indexes (high-traffic tables first)
CREATE INDEX IF NOT EXISTS idx_stages_event ON stages(event_id);
CREATE INDEX IF NOT EXISTS idx_judges_event ON judges(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_competitions_stage ON competitions(stage_id);
CREATE INDEX IF NOT EXISTS idx_competitions_ruleset ON competitions(ruleset_id);
CREATE INDEX IF NOT EXISTS idx_score_entries_comp ON score_entries(competition_id);
CREATE INDEX IF NOT EXISTS idx_score_entries_dancer ON score_entries(dancer_id);
CREATE INDEX IF NOT EXISTS idx_recalls_comp ON recalls(competition_id);
CREATE INDEX IF NOT EXISTS idx_recalls_dancer ON recalls(dancer_id);
CREATE INDEX IF NOT EXISTS idx_results_dancer ON results(dancer_id);
CREATE INDEX IF NOT EXISTS idx_judge_assignments_judge ON judge_assignments(judge_id);
CREATE INDEX IF NOT EXISTS idx_judge_assignments_comp ON judge_assignments(competition_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_event ON event_check_ins(event_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_dancer ON event_check_ins(dancer_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_event ON user_roles(event_id);

-- GIN index for JSONB containment queries on audit_log.after_data
CREATE INDEX IF NOT EXISTS idx_audit_log_after_data ON audit_log USING gin(after_data);

-- Composite index for registration desk queries (event + dancer)
CREATE INDEX IF NOT EXISTS idx_registrations_event_dancer ON registrations(event_id, dancer_id);
