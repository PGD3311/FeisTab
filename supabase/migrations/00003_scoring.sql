-- Score Entries
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

-- Recalls
create table recalls (
  id uuid primary key default uuid_generate_v4(),
  competition_id uuid not null references competitions(id) on delete cascade,
  source_round_id uuid not null references rounds(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  recall_status text not null default 'recalled' check (recall_status in ('recalled', 'declined', 'danced')),
  created_at timestamptz not null default now(),
  unique(competition_id, source_round_id, dancer_id)
);

-- Results
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
