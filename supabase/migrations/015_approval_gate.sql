-- Organizer approval gate: governance metadata for publish/unpublish ceremonies
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS approved_by text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unpublished_by text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unpublished_at timestamptz DEFAULT NULL;
