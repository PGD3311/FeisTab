-- Layer 3: Within-competition rotation — heat generation and snapshot persistence

-- Group size: how many dancers perform at once (1, 2, or 3)
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS group_size integer NOT NULL DEFAULT 2;

-- Display order: dance order within a competition (defaults to competitor_number order)
-- Allows future manual reordering without changing competitor_number
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT NULL;

-- Heat snapshot: persisted heat structure, generated at competition start
-- NULL means heats not yet locked. All views read from this after in_progress.
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS heat_snapshot jsonb DEFAULT NULL;
