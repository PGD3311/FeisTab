-- Irish Points refactor: new columns for flagging, sign-off, number release, teacher tracking

ALTER TABLE dancers ADD COLUMN IF NOT EXISTS teacher_name text;

ALTER TABLE score_entries ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false;
ALTER TABLE score_entries ADD COLUMN IF NOT EXISTS flag_reason text;

ALTER TABLE competitions ADD COLUMN IF NOT EXISTS numbers_released boolean NOT NULL DEFAULT false;

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS judge_sign_offs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Update default rule_set config
UPDATE rule_sets
SET config = '{
  "score_min": 0,
  "score_max": 100,
  "scoring_method": "irish_points",
  "tie_breaker": "countback",
  "recall_top_percent": 50,
  "drop_high": false,
  "drop_low": false
}'::jsonb,
scoring_method = 'irish_points'
WHERE name = 'Default - Raw Score Average';

UPDATE rule_sets
SET name = 'Default - Irish Points'
WHERE name = 'Default - Raw Score Average';
