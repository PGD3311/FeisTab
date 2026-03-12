import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://acxyvouzwgvobtbmvoej.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjeHl2b3V6d2d2b2J0Ym12b2VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNzA3OTgsImV4cCI6MjA4ODc0Njc5OH0.4BTwre6Zih6dtSmZA--zaqruCT651s4DZHq7w8rMXcc'
)

// --- Event ---
const { data: event, error: eventErr } = await supabase.from('events').insert({
  name: 'Garden State Feis 2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  location: 'Meadowlands Expo Center, Secaucus NJ',
  status: 'active',
  registration_code: 'GSF26',
}).select().single()

if (eventErr) { console.error('Event:', eventErr.message); process.exit(1) }
console.log('Created event:', event.id)

// --- Default Ruleset ---
const { data: ruleset } = await supabase
  .from('rule_sets')
  .select('id')
  .limit(1)
  .single()

const rulesetId = ruleset?.id

// --- Competitions ---
const comps = [
  { code: 'U10-BG-R', name: 'Beginner Reel', age_group: 'Under 10', level: 'Beginner' },
  { code: 'U10-BG-LJ', name: 'Beginner Light Jig', age_group: 'Under 10', level: 'Beginner' },
  { code: 'U10-BG-SJ', name: 'Beginner Slip Jig', age_group: 'Under 10', level: 'Beginner' },
  { code: 'U12-PB-R', name: 'Prizewinner Reel', age_group: 'Under 12', level: 'Prizewinner' },
  { code: 'U12-PB-HJ', name: 'Prizewinner Hornpipe', age_group: 'Under 12', level: 'Prizewinner' },
  { code: 'U14-OC-R', name: 'Open Championship Reel', age_group: 'Under 14', level: 'Open Championship' },
  { code: 'U14-OC-SJ', name: 'Open Championship Slip Jig', age_group: 'Under 14', level: 'Open Championship' },
  { code: 'U14-OC-TJ', name: 'Open Championship Treble Jig', age_group: 'Under 14', level: 'Open Championship' },
  { code: 'O18-OC-R', name: 'Open Championship Reel', age_group: 'Over 18', level: 'Open Championship' },
  { code: 'O18-OC-HP', name: 'Open Championship Hornpipe', age_group: 'Over 18', level: 'Open Championship' },
]

const compInserts = comps.map(c => ({
  event_id: event.id,
  code: c.code,
  name: c.name,
  age_group: c.age_group,
  level: c.level,
  status: 'imported',
  ruleset_id: rulesetId,
}))

const { data: competitions, error: compErr } = await supabase
  .from('competitions')
  .insert(compInserts)
  .select()

if (compErr) { console.error('Competitions:', compErr.message); process.exit(1) }
console.log(`Created ${competitions.length} competitions`)

// --- Rounds (1 per competition) ---
const roundInserts = competitions.map(c => ({
  competition_id: c.id,
  round_number: 1,
  round_type: 'standard',
}))

await supabase.from('rounds').insert(roundInserts)
console.log('Created rounds')

// --- Dancers ---
const dancers = [
  { first_name: 'Siobhan', last_name: 'O\'Brien', school_name: 'McGrath Academy' },
  { first_name: 'Aoife', last_name: 'Murphy', school_name: 'McGrath Academy' },
  { first_name: 'Ciara', last_name: 'Kelly', school_name: 'Emerald Isle School' },
  { first_name: 'Niamh', last_name: 'Walsh', school_name: 'Emerald Isle School' },
  { first_name: 'Saoirse', last_name: 'Ryan', school_name: 'Celtic Star Academy' },
  { first_name: 'Maeve', last_name: 'Brennan', school_name: 'Celtic Star Academy' },
  { first_name: 'Roisin', last_name: 'Gallagher', school_name: 'Tara School of Dance' },
  { first_name: 'Aisling', last_name: 'Doyle', school_name: 'Tara School of Dance' },
  { first_name: 'Caoimhe', last_name: 'Fitzgerald', school_name: 'Claddagh Academy' },
  { first_name: 'Orla', last_name: 'Sullivan', school_name: 'Claddagh Academy' },
  { first_name: 'Fionnuala', last_name: 'McCarthy', school_name: 'McGrath Academy' },
  { first_name: 'Deirdre', last_name: 'Connolly', school_name: 'Emerald Isle School' },
  { first_name: 'Eimear', last_name: 'Quinn', school_name: 'Celtic Star Academy' },
  { first_name: 'Grainne', last_name: 'Byrne', school_name: 'Tara School of Dance' },
  { first_name: 'Sorcha', last_name: 'Doherty', school_name: 'Claddagh Academy' },
  { first_name: 'Brigid', last_name: 'Flanagan', school_name: 'McGrath Academy' },
  { first_name: 'Clodagh', last_name: 'Maguire', school_name: 'Emerald Isle School' },
  { first_name: 'Sinead', last_name: 'Kavanagh', school_name: 'Celtic Star Academy' },
  { first_name: 'Emer', last_name: 'Nolan', school_name: 'Tara School of Dance' },
  { first_name: 'Ailbhe', last_name: 'Tierney', school_name: 'Claddagh Academy' },
]

const { data: dancerRows, error: dancerErr } = await supabase
  .from('dancers')
  .insert(dancers)
  .select()

if (dancerErr) { console.error('Dancers:', dancerErr.message); process.exit(1) }
console.log(`Created ${dancerRows.length} dancers`)

// --- Registrations (assign dancers to competitions) ---
// Under 10 Beginner: first 8 dancers, Under 12 Prizewinner: dancers 4-13,
// Under 14 OC: dancers 6-17, Over 18 OC: dancers 10-19
const assignments = [
  { compCodes: ['U10-BG-R', 'U10-BG-LJ', 'U10-BG-SJ'], dancerRange: [0, 8] },
  { compCodes: ['U12-PB-R', 'U12-PB-HJ'], dancerRange: [4, 14] },
  { compCodes: ['U14-OC-R', 'U14-OC-SJ', 'U14-OC-TJ'], dancerRange: [6, 18] },
  { compCodes: ['O18-OC-R', 'O18-OC-HP'], dancerRange: [10, 20] },
]

const regInserts = []
let compNum = 100

for (const { compCodes, dancerRange } of assignments) {
  const compIds = compCodes.map(code => competitions.find(c => c.code === code))
  const assignedDancers = dancerRows.slice(dancerRange[0], dancerRange[1])

  for (const comp of compIds) {
    if (!comp) continue
    for (const dancer of assignedDancers) {
      compNum++
      regInserts.push({
        event_id: event.id,
        competition_id: comp.id,
        dancer_id: dancer.id,
        competitor_number: compNum,
        status: 'registered',
      })
    }
  }
}

const { error: regErr } = await supabase.from('registrations').insert(regInserts)
if (regErr) { console.error('Registrations:', regErr.message); process.exit(1) }
console.log(`Created ${regInserts.length} registrations`)

// --- Judges ---
const judgeNames = [
  { first_name: 'Margaret', last_name: 'Donnelly' },
  { first_name: 'Patrick', last_name: 'Cullen' },
  { first_name: 'Teresa', last_name: 'Heaney' },
]

const judgeInserts = judgeNames.map(j => ({
  event_id: event.id,
  first_name: j.first_name,
  last_name: j.last_name,
  access_code: `${j.last_name.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
}))

const { data: judges, error: judgeErr } = await supabase
  .from('judges')
  .insert(judgeInserts)
  .select()

if (judgeErr) { console.error('Judges:', judgeErr.message); process.exit(1) }
console.log(`Created ${judges.length} judges`)
console.log('\nJudge access codes:')
judges.forEach(j => console.log(`  ${j.first_name} ${j.last_name}: ${j.access_code}`))

// --- Advance some competitions to different statuses ---
// Move first 3 comps to ready_for_day_of → in_progress
const advanceComps = competitions.slice(0, 3)
for (const comp of advanceComps) {
  await supabase.from('competitions').update({ status: 'ready_for_day_of' }).eq('id', comp.id)
  await supabase.from('competitions').update({ status: 'in_progress' }).eq('id', comp.id)
}
console.log(`Advanced ${advanceComps.length} competitions to in_progress`)

console.log('\n✅ Demo seeded! Open http://localhost:3000/dashboard')
console.log(`Event: Garden State Feis 2026 (${event.id})`)
