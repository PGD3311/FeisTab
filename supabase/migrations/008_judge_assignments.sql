-- Judge assignments: links judges to competitions for roster management
-- Also adds roster_confirmed flag to competitions

CREATE TABLE IF NOT EXISTS judge_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id      uuid        NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  competition_id uuid       NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (judge_id, competition_id)
);

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS roster_confirmed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_competitions_roster_confirmed
  ON competitions (roster_confirmed)
  WHERE roster_confirmed = true;
