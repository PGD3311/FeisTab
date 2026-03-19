-- Add entered_at timestamp to score_entries (spec: Phase 1 Completion gap 1)
ALTER TABLE score_entries
  ADD COLUMN IF NOT EXISTS entered_at timestamptz NOT NULL DEFAULT now();
