-- supabase/migrations/027_audit_triggers.sql
-- Auto-log competition status transitions to status_changes table

CREATE OR REPLACE FUNCTION log_competition_status_change()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO status_changes (entity_type, entity_id, from_status, to_status, changed_by, changed_at)
    VALUES ('competition', NEW.id, OLD.status, NEW.status, auth.uid(), now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

CREATE TRIGGER trg_competition_status_change
  AFTER UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION log_competition_status_change();
