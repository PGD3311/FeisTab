-- Competitions
create table competitions (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  code text,
  name text not null,
  age_group text,
  level text,
  stage_id uuid references stages(id),
  ruleset_id uuid references rule_sets(id),
  status text not null default 'draft' check (status in (
    'draft', 'imported', 'ready_for_day_of', 'in_progress',
    'awaiting_scores', 'ready_to_tabulate', 'recalled_round_pending',
    'complete_unpublished', 'published', 'locked'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger competitions_updated_at before update on competitions
  for each row execute function update_updated_at();

-- Registrations
create table registrations (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  competition_id uuid not null references competitions(id) on delete cascade,
  competitor_number text,
  status text not null default 'registered' check (status in (
    'registered', 'checked_in', 'present', 'scratched',
    'no_show', 'danced', 'recalled', 'disqualified', 'finalized'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(competition_id, dancer_id)
);

create trigger registrations_updated_at before update on registrations
  for each row execute function update_updated_at();

-- Rounds
create table rounds (
  id uuid primary key default uuid_generate_v4(),
  competition_id uuid not null references competitions(id) on delete cascade,
  round_number int not null default 1,
  round_type text not null default 'standard' check (round_type in ('standard', 'recall')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_at timestamptz not null default now(),
  unique(competition_id, round_number)
);
