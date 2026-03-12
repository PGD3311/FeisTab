-- Tabulator entry mode support
-- Allows scores to be entered by a tabulator on behalf of a judge

ALTER TABLE score_entries
  ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'judge_self_service';

ALTER TABLE score_entries
  ADD CONSTRAINT score_entries_entry_mode_check
  CHECK (entry_mode IN ('judge_self_service', 'tabulator_transcription'));

ALTER TABLE score_entries
  ADD COLUMN IF NOT EXISTS entered_by_user_id uuid REFERENCES auth.users(id);

COMMENT ON COLUMN score_entries.entry_mode IS 'How the score was entered: judge on their device, or tabulator transcribing paper';
COMMENT ON COLUMN score_entries.entered_by_user_id IS 'User who physically typed the score. NULL = judge self-entry (prototype has no auth)';
