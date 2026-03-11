create extension if not exists "uuid-ossp";

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table events (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  start_date date not null,
  end_date date,
  location text,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger events_updated_at before update on events
  for each row execute function update_updated_at();

create table stages (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create table dancers (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  school_name text,
  created_at timestamptz not null default now()
);

create unique index idx_dancers_name_school on dancers(first_name, last_name, coalesce(school_name, ''));

create table judges (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table rule_sets (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  version int not null default 1,
  scoring_method text not null default 'raw_score_average',
  config jsonb not null default '{"score_min":0,"score_max":100,"aggregation":"average","tie_breaker":"highest_individual","recall_top_n":0,"drop_high":false,"drop_low":false}'::jsonb,
  created_at timestamptz not null default now()
);

insert into rule_sets (name, scoring_method, config) values (
  'Default - Raw Score Average',
  'raw_score_average',
  '{"score_min":0,"score_max":100,"aggregation":"average","tie_breaker":"highest_individual","recall_top_n":0,"drop_high":false,"drop_low":false}'::jsonb
);

create table competitions (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  code text,
  name text not null,
  age_group text,
  level text,
  stage_id uuid references stages(id),
  ruleset_id uuid references rule_sets(id),
  status text not null default 'draft' check (status in ('draft', 'imported', 'ready_for_day_of', 'in_progress', 'awaiting_scores', 'ready_to_tabulate', 'recalled_round_pending', 'complete_unpublished', 'published', 'locked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger competitions_updated_at before update on competitions
  for each row execute function update_updated_at();

create table registrations (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  competition_id uuid not null references competitions(id) on delete cascade,
  competitor_number text,
  status text not null default 'registered' check (status in ('registered', 'checked_in', 'present', 'scratched', 'no_show', 'danced', 'recalled', 'disqualified', 'finalized')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(competition_id, dancer_id)
);

create trigger registrations_updated_at before update on registrations
  for each row execute function update_updated_at();

create table rounds (
  id uuid primary key default uuid_generate_v4(),
  competition_id uuid not null references competitions(id) on delete cascade,
  round_number int not null default 1,
  round_type text not null default 'standard' check (round_type in ('standard', 'recall')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_at timestamptz not null default now(),
  unique(competition_id, round_number)
);

create table score_entries (
  id uuid primary key default uuid_generate_v4(),
  round_id uuid not null references rounds(id) on delete cascade,
  competition_id uuid not null references competitions(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  judge_id uuid not null references judges(id) on delete cascade,
  raw_score numeric,
  rank int,
  points numeric,
  comments text,
  submitted_at timestamptz not null default now(),
  locked_at timestamptz,
  unique(round_id, dancer_id, judge_id)
);

create table recalls (
  id uuid primary key default uuid_generate_v4(),
  competition_id uuid not null references competitions(id) on delete cascade,
  source_round_id uuid not null references rounds(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  recall_status text not null default 'recalled' check (recall_status in ('recalled', 'declined', 'danced')),
  created_at timestamptz not null default now(),
  unique(competition_id, source_round_id, dancer_id)
);

create table results (
  id uuid primary key default uuid_generate_v4(),
  competition_id uuid not null references competitions(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  final_rank int not null,
  display_place text,
  calculated_payload jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique(competition_id, dancer_id)
);

create table status_changes (
  id uuid primary key default uuid_generate_v4(),
  competition_id uuid not null references competitions(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references auth.users(id),
  reason text,
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index idx_status_changes_comp on status_changes(competition_id);
create index idx_status_changes_dancer on status_changes(dancer_id);
create index idx_audit_log_entity on audit_log(entity_type, entity_id);
create index idx_audit_log_user on audit_log(user_id);
create index idx_score_entries_round on score_entries(round_id);
create index idx_score_entries_judge on score_entries(judge_id);
create index idx_registrations_comp on registrations(competition_id);
create index idx_registrations_dancer on registrations(dancer_id);
create index idx_competitions_event on competitions(event_id);
create index idx_results_comp on results(competition_id);

create table user_roles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  role text not null check (role in ('super_admin', 'organizer', 'tabulator', 'stage_manager', 'judge', 'viewer')),
  created_at timestamptz not null default now(),
  unique(user_id, event_id, role)
);

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
