-- Layer 1: Schedule backbone — gives competitions a run order within stages
-- Also fixes CHECK constraint to include released_to_judge (added in Layer 2)

-- Add schedule columns
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS schedule_position integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dance_type text DEFAULT NULL;

-- Common dance_type values: reel, jig, hornpipe, slip_jig, treble_jig, set_dance
-- Free text for now — no enforcement until Phase 2

-- Two competitions cannot occupy the same position on the same stage
ALTER TABLE competitions
  ADD CONSTRAINT competitions_stage_schedule_unique
  UNIQUE (stage_id, schedule_position);

-- Fix: original CHECK constraint (migration 00002) does not include released_to_judge.
-- Drop and re-add with the full status set.
ALTER TABLE competitions DROP CONSTRAINT IF EXISTS competitions_status_check;
ALTER TABLE competitions ADD CONSTRAINT competitions_status_check
  CHECK (status IN (
    'draft', 'imported', 'ready_for_day_of', 'released_to_judge', 'in_progress',
    'awaiting_scores', 'ready_to_tabulate', 'recalled_round_pending',
    'complete_unpublished', 'published', 'locked'
  ));
