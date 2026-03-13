-- Upgrade roster_confirmed boolean to auditable timestamp fields
-- Also supports the new released_to_judge status

-- Add new columns
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS roster_confirmed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS roster_confirmed_by text DEFAULT NULL;

-- Migrate existing data: set timestamp for already-confirmed competitions
UPDATE competitions
  SET roster_confirmed_at = now()
  WHERE roster_confirmed = true
    AND roster_confirmed_at IS NULL;

-- Drop the old boolean column
ALTER TABLE competitions
  DROP COLUMN IF EXISTS roster_confirmed;
