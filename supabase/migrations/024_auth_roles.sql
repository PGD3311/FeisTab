-- supabase/migrations/024_auth_roles.sql
-- Replaces user_roles with event_roles. user_roles has no production data.

-- 0. Ensure judges.user_id FK exists (may already exist from 00001)
ALTER TABLE judges ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- 1. Drop old table
DROP TABLE IF EXISTS user_roles;

-- 2. Create event_roles
CREATE TABLE event_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('organizer', 'registration_desk', 'side_stage', 'judge')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id, event_id, role)
);

-- Index for user_event_role() helper (used in every RLS policy)
CREATE INDEX idx_event_roles_user_event ON event_roles(user_id, event_id);

-- 3. Judge exclusivity trigger
CREATE OR REPLACE FUNCTION enforce_judge_exclusivity()
RETURNS trigger AS $$
BEGIN
  IF NEW.role = 'judge' THEN
    IF EXISTS (
      SELECT 1 FROM event_roles
      WHERE user_id = NEW.user_id AND event_id = NEW.event_id AND role != 'judge'
    ) THEN
      RAISE EXCEPTION 'judge role is mutually exclusive with other roles for the same event';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM event_roles
      WHERE user_id = NEW.user_id AND event_id = NEW.event_id AND role = 'judge'
    ) THEN
      RAISE EXCEPTION 'cannot add non-judge role when user is a judge for this event';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public;

CREATE TRIGGER trg_judge_exclusivity
  BEFORE INSERT OR UPDATE ON event_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_judge_exclusivity();

-- 4. Create pending_invitations
CREATE TABLE pending_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('organizer', 'registration_desk', 'side_stage', 'judge')),
  judge_id uuid REFERENCES judges(id),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE(email, event_id, role)
);

-- 5. user_event_role() helper — used in RLS policies
CREATE OR REPLACE FUNCTION user_event_role(p_event_id uuid)
RETURNS text[] AS $$
  SELECT COALESCE(array_agg(role), '{}')
  FROM event_roles
  WHERE user_id = auth.uid() AND event_id = p_event_id
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;
