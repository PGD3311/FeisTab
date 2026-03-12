-- Add registration_code column to events table
-- Used by the new event form to generate a shareable code
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_code text;
