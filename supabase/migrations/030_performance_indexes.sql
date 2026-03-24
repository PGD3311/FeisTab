-- supabase/migrations/030_performance_indexes.sql
-- Performance indexes for RLS policy overhead and common query patterns

-- Speeds up dancers_select_role policy (registration desk, comments)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registrations_dancer_event
  ON registrations(dancer_id, event_id);

-- Speeds up score_entries reads by round + judge
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_score_entries_round_judge
  ON score_entries(round_id, judge_id);

-- Speeds up public results queries (partial index on published only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_results_comp_published
  ON results(competition_id, final_rank) WHERE published_at IS NOT NULL;

-- Speeds up audit log queries (entity_type + entity_id + created_at ordering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_entity_created
  ON audit_log(entity_type, entity_id, created_at DESC);
