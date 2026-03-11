-- Judge access codes for PIN-based login
ALTER TABLE judges ADD COLUMN IF NOT EXISTS access_code text UNIQUE;
