-- Add schedule fields to competitions
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS schedule_position int;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS dance_type text;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS group_size int NOT NULL DEFAULT 2;
