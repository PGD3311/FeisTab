-- supabase/migrations/024b_identity_backfill.sql
-- One-time backfill: map existing prototype actors to event_roles.
-- Run after 024_auth_roles.sql creates the event_roles table.

-- 1. Events where created_by is a real auth user get organizer role
INSERT INTO event_roles (user_id, event_id, role, created_by)
SELECT e.created_by, e.id, 'organizer', e.created_by
FROM events e
WHERE e.created_by IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2. Judges with user_id already linked get judge role
INSERT INTO event_roles (user_id, event_id, role, created_by)
SELECT j.user_id, j.event_id, 'judge', j.user_id
FROM judges j
WHERE j.user_id IS NOT NULL
ON CONFLICT DO NOTHING;
