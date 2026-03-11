-- Anomaly detection support: edit tracking, extended status, status_reason

-- Track score edits for audit trail
ALTER TABLE score_entries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE TRIGGER score_entries_updated_at
  BEFORE UPDATE ON score_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Extend registration status to cover did_not_complete and medical
ALTER TABLE registrations
  DROP CONSTRAINT IF EXISTS registrations_status_check;

ALTER TABLE registrations
  ADD CONSTRAINT registrations_status_check
  CHECK (status IN (
    'registered', 'checked_in', 'present', 'scratched',
    'no_show', 'danced', 'recalled', 'disqualified', 'finalized',
    'did_not_complete', 'medical'
  ));

-- Separate explanatory reason from workflow status
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS status_reason text
  CHECK (status_reason IS NULL OR status_reason IN (
    'withdrawn', 'absent', 'disqualified',
    'did_not_complete', 'medical', 'admin_hold', 'other'
  ));
