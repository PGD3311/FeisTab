-- 034_invitation_links.sql
-- Invitations become shareable links (/auth/invite/<token>) that the organizer
-- emails or texts. The token is the secret; expires_at bounds how long a link
-- lives, and resending pushes it out again. Additive: existing rows get a token.

ALTER TABLE pending_invitations
  ADD COLUMN IF NOT EXISTS token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_invitations_token ON pending_invitations(token);
