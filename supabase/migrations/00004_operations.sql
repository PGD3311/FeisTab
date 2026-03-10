-- Status Changes
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

-- Audit Log
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

-- Indexes for common queries
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

-- User roles table
create table user_roles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  role text not null check (role in ('super_admin', 'organizer', 'tabulator', 'stage_manager', 'judge', 'viewer')),
  created_at timestamptz not null default now(),
  unique(user_id, event_id, role)
);
