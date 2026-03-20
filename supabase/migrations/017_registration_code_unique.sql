-- Add unique constraint to registration_code
-- Prevents duplicate access codes from routing users to wrong events
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_registration_code_unique
  ON events(registration_code)
  WHERE registration_code IS NOT NULL;
