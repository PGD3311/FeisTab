-- 036_recalls_championships_only.sql
-- Fix from the 2026-10-14 mock feis dress rehearsal: no competition could be tabulated.
--
-- Recalls are a championship rule, not a grade rule (Beginner, Novice, Prizewinner).
-- But the only rule set, "Default - Irish Points", had recall_top_percent 50, and
-- every imported competition got it. So the "Recalls not generated" check blocked
-- tabulation of every competition, including a Beginner U10 Reel.
--
-- 1. The default rule set has recalls off (recall_top_percent 0).
-- 2. A new "Championship - Irish Points" rule set keeps recall_top_percent 50.
-- 3. A trigger gives a new competition the championship rule set when its name or
--    level says "championship" (CSV import and the pre-reg bridge both insert into
--    competitions; the bridge sets no rule set at all). An explicitly chosen
--    non-default rule set is left alone.
-- 4. Backfill competitions that haven't been tabulated yet.

-------------------------------------------------------
-- 1–2. Rule sets
-------------------------------------------------------
UPDATE rule_sets
SET config = jsonb_set(config, '{recall_top_percent}', '0'::jsonb)
WHERE name = 'Default - Irish Points';

INSERT INTO rule_sets (name, scoring_method, config)
SELECT 'Championship - Irish Points', 'irish_points',
  '{"score_min":0,"score_max":100,"scoring_method":"irish_points","tie_breaker":"countback","recall_top_percent":50,"drop_high":false,"drop_low":false}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM rule_sets WHERE name = 'Championship - Irish Points');

-------------------------------------------------------
-- 3. Championship detection + rule set assignment on insert
-------------------------------------------------------
-- CSV: level "Preliminary Championship" / "Open Championship".
-- Pre-reg bridge: name "U14 Preliminary Championship" (level holds the minimum grade).
CREATE OR REPLACE FUNCTION is_championship_competition(p_name text, p_level text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(p_name, '') ~* 'champ' OR COALESCE(p_level, '') ~* 'champ'
$$;

CREATE OR REPLACE FUNCTION assign_competition_ruleset()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_default uuid; v_champ uuid;
BEGIN
  SELECT id INTO v_default FROM rule_sets WHERE name = 'Default - Irish Points' LIMIT 1;
  SELECT id INTO v_champ FROM rule_sets WHERE name = 'Championship - Irish Points' LIMIT 1;

  IF NEW.ruleset_id IS NULL OR NEW.ruleset_id = v_default THEN
    NEW.ruleset_id := CASE
      WHEN is_championship_competition(NEW.name, NEW.level) THEN COALESCE(v_champ, v_default)
      ELSE v_default
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_competition_ruleset ON competitions;
CREATE TRIGGER trg_assign_competition_ruleset
  BEFORE INSERT ON competitions
  FOR EACH ROW EXECUTE FUNCTION assign_competition_ruleset();

-------------------------------------------------------
-- 4. Backfill — leave tabulated/published competitions as they were
-------------------------------------------------------
UPDATE competitions c
SET ruleset_id = CASE
  WHEN is_championship_competition(c.name, c.level)
    THEN (SELECT id FROM rule_sets WHERE name = 'Championship - Irish Points' LIMIT 1)
  ELSE (SELECT id FROM rule_sets WHERE name = 'Default - Irish Points' LIMIT 1)
END
WHERE c.status NOT IN ('complete_unpublished', 'published', 'locked')
  AND (c.ruleset_id IS NULL
       OR c.ruleset_id = (SELECT id FROM rule_sets WHERE name = 'Default - Irish Points' LIMIT 1));

-------------------------------------------------------
-- Grants (same pattern as 032)
-------------------------------------------------------
REVOKE EXECUTE ON FUNCTION is_championship_competition(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_championship_competition(text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION assign_competition_ruleset() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION assign_competition_ruleset() TO authenticated, service_role;
