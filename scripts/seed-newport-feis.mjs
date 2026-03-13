import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://acxyvouzwgvobtbmvoej.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjeHl2b3V6d2d2b2J0Ym12b2VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNzA3OTgsImV4cCI6MjA4ODc0Njc5OH0.4BTwre6Zih6dtSmZA--zaqruCT651s4DZHq7w8rMXcc'
)

const FORCE = process.argv.includes('--force')

// ─── Helper: check Supabase errors ─────────────────────────────────────────
function check(label, result) {
  if (result.error) {
    console.error(`[ERROR] ${label}:`, result.error.message)
    process.exit(1)
  }
  return result.data
}

// ─── Dance abbreviation map ────────────────────────────────────────────────
const DANCE_NAMES = {
  R: 'Reel',
  LJ: 'Light Jig',
  SJ: 'Slip Jig',
  HJ: 'Heavy Jig',
  HP: 'Hornpipe',
  TS: 'Treble Jig',
}

// ─── Build full syllabus ───────────────────────────────────────────────────
function buildCompetitions() {
  const comps = []

  // Pre-Beginner (Girls & Boys, 1 step 1 at a time)
  const preBegAges = [
    { age: 'Under 5', dances: ['R', 'LJ'], startCode: 1 },
    { age: 'Under 6', dances: ['R', 'LJ'], startCode: 3 },
  ]
  for (const { age, dances, startCode } of preBegAges) {
    dances.forEach((d, i) => {
      comps.push({
        code: String(startCode + i),
        name: `Pre-Beginner ${age} ${DANCE_NAMES[d]}`,
        age_group: age,
        level: 'Pre-Beginner',
      })
    })
  }

  // Beginner (codes 5-31)
  const begAges = [
    'Under 5', 'Under 6', 'Under 7', 'Under 8', 'Under 9',
    'Under 10', 'Under 11', 'Under 12', '12 & Over',
  ]
  const begDances = ['R', 'LJ', 'SJ']
  let begCode = 5
  for (const age of begAges) {
    for (const d of begDances) {
      comps.push({
        code: String(begCode),
        name: `Beginner ${age} ${DANCE_NAMES[d]}`,
        age_group: age,
        level: 'Beginner',
      })
      begCode++
    }
  }

  // Advanced Beginner (codes 101-150)
  const abAges = [
    'Under 6', 'Under 7', 'Under 8', 'Under 9', 'Under 10',
    'Under 11', 'Under 12', 'Under 13', 'Under 14', '14 & Over',
  ]
  const abDances = ['R', 'LJ', 'SJ', 'HJ', 'HP']
  let abCode = 101
  for (const age of abAges) {
    for (const d of abDances) {
      comps.push({
        code: String(abCode),
        name: `Advanced Beginner ${age} ${DANCE_NAMES[d]}`,
        age_group: age,
        level: 'Advanced Beginner',
      })
      abCode++
    }
  }

  // Novice (codes 201-260)
  const novAges = [...abAges]
  const novDances = ['R', 'LJ', 'SJ', 'HJ', 'HP', 'TS']
  let novCode = 201
  for (const age of novAges) {
    for (const d of novDances) {
      comps.push({
        code: String(novCode),
        name: `Novice ${age} ${DANCE_NAMES[d]}`,
        age_group: age,
        level: 'Novice',
      })
      novCode++
    }
  }

  // Prizewinner (codes 301-360)
  const pwAges = [...abAges]
  const pwDances = ['R', 'LJ', 'SJ', 'HJ', 'HP', 'TS']
  let pwCode = 301
  for (const age of pwAges) {
    for (const d of pwDances) {
      comps.push({
        code: String(pwCode),
        name: `Prizewinner ${age} ${DANCE_NAMES[d]}`,
        age_group: age,
        level: 'Prizewinner',
      })
      pwCode++
    }
  }

  // Adult (codes 901-906)
  const adultDances = ['R', 'LJ', 'SJ', 'HJ', 'HP', 'TS']
  let adultCode = 901
  for (const d of adultDances) {
    comps.push({
      code: String(adultCode),
      name: `Adult ${DANCE_NAMES[d]}`,
      age_group: 'Adult',
      level: 'Adult',
    })
    adultCode++
  }

  // Preliminary Championship (codes 400-409)
  const pcAges = [
    'Under 8', 'Under 9', 'Under 10', 'Under 11', 'Under 12',
    'Under 13', 'Under 14', 'Under 15', 'Under 16', '16 & Over',
  ]
  let pcCode = 400
  for (const age of pcAges) {
    comps.push({
      code: String(pcCode),
      name: `Preliminary Championship ${age}`,
      age_group: age,
      level: 'Preliminary Championship',
    })
    pcCode++
  }

  // Open Championship Girls (codes 500-511)
  const ocgAges = [
    'Under 8', 'Under 9', 'Under 10', 'Under 11', 'Under 12',
    'Under 13', 'Under 14', 'Under 15', 'Under 16', 'Under 17',
    'Under 18', '18 & Over',
  ]
  let ocgCode = 500
  for (const age of ocgAges) {
    comps.push({
      code: String(ocgCode),
      name: `Open Championship Girls ${age}`,
      age_group: age,
      level: 'Open Championship',
    })
    ocgCode++
  }

  // Open Championship Boys (codes 512-519)
  const ocbEntries = [
    { code: '512', age: 'Under 8' },
    { code: '513', age: 'Under 9' },
    { code: '514', age: 'Under 10' },
    { code: '515', age: 'Under 12' },
    { code: '516', age: 'Under 14' },
    { code: '517', age: 'Under 16' },
    { code: '518', age: 'Under 18' },
    { code: '519', age: '18 & Over' },
  ]
  for (const { code, age } of ocbEntries) {
    comps.push({
      code,
      name: `Open Championship Boys ${age}`,
      age_group: age,
      level: 'Open Championship',
    })
  }

  return comps
}

// ─── Name pools ────────────────────────────────────────────────────────────
const FIRST_NAMES_FEMALE = [
  'Aoife', 'Siobhan', 'Ciara', 'Niamh', 'Saoirse', 'Roisin', 'Maeve',
  'Aisling', 'Orla', 'Caoimhe', 'Fiona', 'Grainne', 'Sinead', 'Deirdre',
  'Clodagh', 'Eimear', 'Tara', 'Shauna', 'Eileen', 'Bridget', 'Molly',
  'Nora', 'Kathleen', 'Riley', 'Quinn', 'Reagan', 'Kennedy', 'Teagan',
  'Megan', 'Emma', 'Lily', 'Grace', 'Sophie', 'Hannah', 'Ella', 'Abby',
  'Caitlin', 'Keira', 'Anna', 'Sarah', 'Emily', 'Charlotte', 'Lucy', 'Isla',
]

const FIRST_NAMES_MALE = [
  'Declan', 'Cian', 'Liam', 'Sean', 'Conor', 'Padraig', 'Eoin', 'Oisin',
  'Darragh', 'Finn', 'Ronan', 'Callum', 'Aidan', 'Patrick', 'Brendan',
  'Kieran', 'Niall', 'Rory', 'Shane', 'Colin', 'Ryan', 'Jack', 'Owen',
]

const LAST_NAMES = [
  "O'Brien", 'Murphy', 'Kelly', 'Sullivan', 'Walsh', 'McCarthy',
  'Gallagher', 'Byrne', 'Ryan', 'Doherty', 'Kennedy', 'Lynch', 'Murray',
  'Quinn', 'Moore', 'McLaughlin', 'Carroll', 'Connolly', 'Daly', 'Maguire',
  'Reilly', 'Nolan', 'Flynn', 'Doyle', 'Brennan', 'Burke', 'Fitzgerald',
  'Foley', 'Healy', 'Kavanagh', 'Keane', 'Mahon', 'Power', 'Sheridan',
  'Tobin', 'Whelan', 'Duffy', 'Farrell', 'Griffin', 'Hayes', 'Higgins',
  'Hogan', 'Kearney', 'Madden', 'Moran', 'Regan', 'Sweeney', 'Tierney',
  'Ward',
]

const SCHOOLS = [
  'Clann Lir Academy', 'Mulvihill Academy', 'Kenneally School',
  'Brady Campbell School', 'Hogan School', 'Comerford School',
  'McGing School', 'Harney Academy', 'Lenihan School', 'Petri School',
  'Aisling School', 'Celtic Steps Academy', 'Emerald Isle Academy',
  'Tir Na nOg School', 'Scoil Rince Academy',
]

// Seeded random for reproducibility
let _seed = 42
function seededRandom() {
  _seed = (_seed * 16807 + 0) % 2147483647
  return (_seed - 1) / 2147483646
}

function pick(arr) {
  return arr[Math.floor(seededRandom() * arr.length)]
}

function randInt(min, max) {
  return min + Math.floor(seededRandom() * (max - min + 1))
}

// Generate unique dancer names
function generateDancerPool(count) {
  const allFirst = [...FIRST_NAMES_FEMALE, ...FIRST_NAMES_MALE]
  const used = new Set()
  const dancers = []

  while (dancers.length < count) {
    const first = pick(allFirst)
    const last = pick(LAST_NAMES)
    const school = pick(SCHOOLS)
    const key = `${first}|${last}|${school}`
    if (used.has(key)) continue
    used.add(key)
    dancers.push({ first_name: first, last_name: last, school_name: school })
  }
  return dancers
}

// ─── Group competitions by (level, age_group) ─────────────────────────────
function groupCompetitions(compDefs) {
  const groups = new Map()
  for (const c of compDefs) {
    const key = `${c.level}|||${c.age_group}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  return groups
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Newport Feis 2026 Seed Script ===')
  if (FORCE) console.log('--force mode: will clear existing data\n')

  // 1. Create or find the event
  let event
  const { data: existing } = await supabase
    .from('events')
    .select('*')
    .eq('name', 'Newport Feis 2026')
    .limit(1)
    .maybeSingle()

  if (existing) {
    console.log(`Found existing event: ${existing.id}`)
    event = existing

    if (FORCE) {
      console.log('Clearing existing competitions, rounds, registrations...')

      // Get competition IDs for this event
      const { data: existingComps } = await supabase
        .from('competitions')
        .select('id')
        .eq('event_id', event.id)

      if (existingComps && existingComps.length > 0) {
        const compIds = existingComps.map(c => c.id)

        // Delete registrations for these competitions
        for (const cid of compIds) {
          await supabase.from('registrations').delete().eq('competition_id', cid)
        }

        // Delete rounds for these competitions
        for (const cid of compIds) {
          await supabase.from('rounds').delete().eq('competition_id', cid)
        }

        // Delete competitions
        await supabase.from('competitions').delete().eq('event_id', event.id)
      }

      // Delete judges for this event
      await supabase.from('judges').delete().eq('event_id', event.id)

      console.log('Cleared.')
    }
  } else {
    event = check('Create event', await supabase.from('events').insert({
      name: 'Newport Feis 2026',
      start_date: '2026-02-21',
      end_date: '2026-02-21',
      location: 'Newport Harbor Island Resort, Newport RI',
      status: 'active',
      registration_code: 'NEWPORT26',
    }).select().single())
    console.log(`Created event: ${event.id}`)
  }

  // 2. Find default ruleset
  const { data: ruleset } = await supabase
    .from('rule_sets')
    .select('id')
    .eq('name', 'Default - Irish Points')
    .limit(1)
    .single()

  const rulesetId = ruleset?.id
  if (!rulesetId) {
    console.warn('WARNING: No "Default - Irish Points" ruleset found. Competitions will have null ruleset_id.')
  }

  // 3. Create all competitions from syllabus
  const compDefs = buildCompetitions()
  console.log(`\nSyllabus defines ${compDefs.length} competitions`)

  const compInserts = compDefs.map(c => ({
    event_id: event.id,
    code: c.code,
    name: c.name,
    age_group: c.age_group,
    level: c.level,
    status: 'imported',
    ruleset_id: rulesetId,
  }))

  // Insert in batches of 50 to avoid payload limits
  const allComps = []
  for (let i = 0; i < compInserts.length; i += 50) {
    const batch = compInserts.slice(i, i + 50)
    const result = check(
      `Insert competitions batch ${Math.floor(i / 50) + 1}`,
      await supabase.from('competitions').insert(batch).select()
    )
    allComps.push(...result)
  }
  console.log(`Created ${allComps.length} competitions`)

  // 4. Create Round 1 for each competition
  const roundInserts = allComps.map(c => ({
    competition_id: c.id,
    round_number: 1,
    round_type: 'standard',
  }))

  for (let i = 0; i < roundInserts.length; i += 50) {
    const batch = roundInserts.slice(i, i + 50)
    check(
      `Insert rounds batch ${Math.floor(i / 50) + 1}`,
      await supabase.from('rounds').insert(batch)
    )
  }
  console.log(`Created ${roundInserts.length} rounds`)

  // 5. Generate dancer pool
  const dancerPool = generateDancerPool(200)

  // The unique index uses coalesce(school_name, ''), which is expression-based
  // and can't be used with onConflict. So we try inserting and fall back to
  // selecting existing dancers.
  const allDancers = []
  let insertedCount = 0
  for (let i = 0; i < dancerPool.length; i += 50) {
    const batch = dancerPool.slice(i, i + 50)
    const result = await supabase.from('dancers').insert(batch).select()

    if (result.error) {
      // Likely duplicate constraint — insert one by one and fetch existing
      for (const d of batch) {
        const single = await supabase.from('dancers').insert(d).select().single()
        if (single.error) {
          // Already exists — fetch it
          const { data: existing } = await supabase
            .from('dancers')
            .select('*')
            .eq('first_name', d.first_name)
            .eq('last_name', d.last_name)
            .eq('school_name', d.school_name)
            .limit(1)
            .single()
          if (existing) {
            allDancers.push(existing)
          } else {
            console.warn(`  Could not find or create dancer: ${d.first_name} ${d.last_name}`)
          }
        } else {
          allDancers.push(single.data)
          insertedCount++
        }
      }
    } else {
      allDancers.push(...result.data)
      insertedCount += result.data.length
    }
  }
  console.log(`Dancers: ${insertedCount} created, ${allDancers.length - insertedCount} existing, ${allDancers.length} total`)

  // 6. Register dancers into competitions
  // Group competitions by (level, age_group) — each group gets a cohort of dancers
  const groups = groupCompetitions(compDefs)
  const compByCode = new Map(allComps.map(c => [c.code, c]))

  let compNum = 99  // will increment to 100 first
  let totalRegs = 0
  let dancerIdx = 0
  const regInserts = []
  const levelStats = {}

  for (const [key, groupComps] of groups) {
    const [level, ageGroup] = key.split('|||')

    // Determine cohort size based on level
    let cohortSize
    if (level === 'Pre-Beginner') cohortSize = randInt(5, 12)
    else if (level === 'Beginner') cohortSize = randInt(8, 18)
    else if (level === 'Advanced Beginner') cohortSize = randInt(6, 15)
    else if (level === 'Novice') cohortSize = randInt(6, 14)
    else if (level === 'Prizewinner') cohortSize = randInt(5, 12)
    else if (level === 'Adult') cohortSize = randInt(5, 10)
    else if (level === 'Preliminary Championship') cohortSize = randInt(8, 20)
    else if (level === 'Open Championship') cohortSize = randInt(8, 25)
    else cohortSize = randInt(5, 15)

    // Pick a contiguous slice of dancers, wrapping around
    const cohort = []
    for (let i = 0; i < cohortSize; i++) {
      cohort.push(allDancers[(dancerIdx + i) % allDancers.length])
      compNum++
    }
    dancerIdx = (dancerIdx + cohortSize) % allDancers.length

    // Track stats
    if (!levelStats[level]) levelStats[level] = { comps: 0, dancerIds: new Set() }
    levelStats[level].comps += groupComps.length

    // Register each dancer into ALL competitions in this group
    for (const compDef of groupComps) {
      const comp = compByCode.get(compDef.code)
      if (!comp) continue

      for (let di = 0; di < cohort.length; di++) {
        const dancer = cohort[di]
        regInserts.push({
          event_id: event.id,
          competition_id: comp.id,
          dancer_id: dancer.id,
          competitor_number: compNum - cohort.length + di + 1,
          status: 'registered',
        })
        levelStats[level].dancerIds.add(dancer.id)
      }
    }
  }

  // Insert registrations in batches
  for (let i = 0; i < regInserts.length; i += 100) {
    const batch = regInserts.slice(i, i + 100)
    const result = await supabase.from('registrations').insert(batch)
    if (result.error) {
      // If it's a unique constraint violation, some already exist — skip
      if (result.error.message.includes('duplicate') || result.error.code === '23505') {
        console.warn(`  Batch ${Math.floor(i / 100) + 1}: some registrations already exist, skipping duplicates`)
      } else {
        console.error(`[ERROR] Insert registrations batch ${Math.floor(i / 100) + 1}:`, result.error.message)
        process.exit(1)
      }
    }
    totalRegs += batch.length
  }
  console.log(`Created ${totalRegs} registrations`)

  // 7. Create 5 judges
  const judgeNames = [
    { first_name: 'Margaret', last_name: 'Donnelly' },
    { first_name: 'Patrick', last_name: 'Cullen' },
    { first_name: 'Teresa', last_name: 'Heaney' },
    { first_name: 'Colm', last_name: 'Feeney' },
    { first_name: 'Bernadette', last_name: 'Langan' },
  ]

  const judgeInserts = judgeNames.map((j, i) => ({
    event_id: event.id,
    first_name: j.first_name,
    last_name: j.last_name,
    access_code: `${j.last_name.toUpperCase()}-${1001 + i}`,
  }))

  const judges = check('Insert judges', await supabase
    .from('judges')
    .insert(judgeInserts)
    .select()
  )
  console.log(`Created ${judges.length} judges`)

  // 8. Summary
  const uniqueDancerIds = new Set()
  for (const stats of Object.values(levelStats)) {
    for (const id of stats.dancerIds) uniqueDancerIds.add(id)
  }

  console.log('\n════════════════════════════════════════════')
  console.log('  Newport Feis 2026 — Seed Summary')
  console.log('════════════════════════════════════════════')
  console.log(`  Event:          ${event.name} (${event.id})`)
  console.log(`  Competitions:   ${allComps.length}`)
  console.log(`  Unique dancers: ${uniqueDancerIds.size}`)
  console.log(`  Registrations:  ${totalRegs}`)
  console.log('')
  console.log('  Judge Access Codes:')
  for (const j of judges) {
    console.log(`    ${j.first_name} ${j.last_name}: ${j.access_code}`)
  }
  console.log('')
  console.log('  Per-level breakdown:')
  for (const [level, stats] of Object.entries(levelStats)) {
    console.log(`    ${level}: ${stats.comps} comps, ${stats.dancerIds.size} dancers`)
  }
  console.log('════════════════════════════════════════════')
  console.log('Done!')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
