-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Auto-update updated_at trigger function (used by multiple tables)
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Events
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

-- Stages
create table stages (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Dancers (unique on first_name + last_name + school_name for dedup)
create table dancers (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  school_name text,
  created_at timestamptz not null default now()
);

-- Composite index for dancer dedup lookups
create unique index idx_dancers_name_school on dancers(first_name, last_name, coalesce(school_name, ''));

-- Judges
create table judges (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Rule Sets
create table rule_sets (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  version int not null default 1,
  scoring_method text not null default 'raw_score_average',
  config jsonb not null default '{
    "score_min": 0,
    "score_max": 100,
    "aggregation": "average",
    "tie_breaker": "highest_individual",
    "recall_top_n": 0,
    "drop_high": false,
    "drop_low": false
  }'::jsonb,
  created_at timestamptz not null default now()
);

-- Seed default rule set
insert into rule_sets (name, scoring_method, config) values (
  'Default - Raw Score Average',
  'raw_score_average',
  '{
    "score_min": 0,
    "score_max": 100,
    "aggregation": "average",
    "tie_breaker": "highest_individual",
    "recall_top_n": 0,
    "drop_high": false,
    "drop_low": false
  }'::jsonb
);
