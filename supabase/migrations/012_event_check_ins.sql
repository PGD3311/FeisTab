-- Event Check-Ins: source of truth for competitor number + event-day arrival
create table event_check_ins (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  dancer_id uuid not null references dancers(id) on delete cascade,
  competitor_number text not null,
  checked_in_at timestamptz,
  checked_in_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, dancer_id),
  unique(event_id, competitor_number)
);

create trigger event_check_ins_updated_at before update on event_check_ins
  for each row execute function update_updated_at();

-- Backfill from existing registration data
-- Only creates rows where exactly one distinct competitor_number exists per dancer/event
insert into event_check_ins (event_id, dancer_id, competitor_number, checked_in_by)
select
  r.event_id,
  r.dancer_id,
  min(r.competitor_number) as competitor_number,
  'backfill'
from registrations r
where r.competitor_number is not null
group by r.event_id, r.dancer_id
having count(distinct r.competitor_number) = 1;

-- Log conflicts (dancers with multiple different competitor numbers in same event)
do $$
declare
  conflict_count int;
begin
  select count(*) into conflict_count
  from (
    select r.event_id, r.dancer_id
    from registrations r
    where r.competitor_number is not null
    group by r.event_id, r.dancer_id
    having count(distinct r.competitor_number) > 1
  ) conflicts;

  if conflict_count > 0 then
    raise notice 'MIGRATION WARNING: % dancer(s) have conflicting competitor numbers across registrations. These were NOT backfilled into event_check_ins and require manual cleanup.', conflict_count;
  end if;
end $$;
