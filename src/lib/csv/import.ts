import Papa from 'papaparse'

export interface ImportRow {
  first_name: string
  last_name: string
  competitor_number: string
  age_group: string
  level: string
  competition_code: string
  competition_name: string
  school_name?: string
}

export interface ImportError {
  row: number
  message: string
}

export interface ImportWarning {
  row: number
  message: string
}

export interface ImportResult {
  valid: ImportRow[]
  errors: ImportError[]
  warnings: ImportWarning[]
}

const REQUIRED_FIELDS: (keyof ImportRow)[] = [
  'first_name',
  'last_name',
  'competitor_number',
  'age_group',
  'level',
  'competition_code',
  'competition_name',
]

export function parseRegistrationCSV(csvText: string): ImportResult {
  const valid: ImportRow[] = []
  const errors: ImportError[] = []
  const warnings: ImportWarning[] = []

  if (!csvText.trim()) return { valid, errors, warnings }

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i]
    const missing = REQUIRED_FIELDS.filter(f => !raw[f]?.trim())

    if (missing.length > 0) {
      errors.push({ row: i + 1, message: `Missing required fields: ${missing.join(', ')}` })
      continue
    }

    valid.push({
      first_name: raw.first_name.trim(),
      last_name: raw.last_name.trim(),
      competitor_number: raw.competitor_number.trim(),
      age_group: raw.age_group.trim(),
      level: raw.level.trim(),
      competition_code: raw.competition_code.trim(),
      competition_name: raw.competition_name.trim(),
      school_name: raw.school_name?.trim() || undefined,
    })
  }

  // Check for duplicate competitor numbers within same competition
  const seen = new Map<string, number>()
  for (let i = 0; i < valid.length; i++) {
    const key = `${valid[i].competition_code}:${valid[i].competitor_number}`
    if (seen.has(key)) {
      warnings.push({
        row: i + 1,
        message: `duplicate competitor number ${valid[i].competitor_number} in competition ${valid[i].competition_code}`,
      })
    }
    seen.set(key, i + 1)
  }

  // Warn on same name with different schools (possible distinct dancers sharing a name)
  const nameSchools = new Map<string, Set<string>>()
  for (let i = 0; i < valid.length; i++) {
    const nameKey = `${valid[i].first_name}:${valid[i].last_name}`.toLowerCase()
    if (!nameSchools.has(nameKey)) nameSchools.set(nameKey, new Set())
    nameSchools.get(nameKey)!.add(valid[i].school_name ?? '')
  }
  for (const [nameKey, schools] of nameSchools) {
    if (schools.size > 1) {
      const [first, last] = nameKey.split(':')
      warnings.push({
        row: 0,
        message: `"${first} ${last}" appears with ${schools.size} different schools — same name, different dancers?`,
      })
    }
  }

  return { valid, errors, warnings }
}
