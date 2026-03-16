import { describe, it, expect } from 'vitest'
import { parseRegistrationCSV, type ImportRow, type ImportResult } from '@/lib/csv/import'

describe('parseRegistrationCSV', () => {
  it('parses valid CSV rows', () => {
    const csv = `first_name,last_name,competitor_number,age_group,level,competition_code,competition_name
Siobhan,Murphy,101,U12,Beginner,B-U12-R1,Beginner U12 Reel
Aoife,Kelly,102,U12,Beginner,B-U12-R1,Beginner U12 Reel`

    const result = parseRegistrationCSV(csv)
    expect(result.valid).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(result.valid[0].first_name).toBe('Siobhan')
    expect(result.valid[0].competitor_number).toBe('101')
  })

  it('flags rows missing required fields', () => {
    const csv = `first_name,last_name,competitor_number,age_group,level,competition_code,competition_name
Siobhan,,101,U12,Beginner,B-U12-R1,Beginner U12 Reel`

    const result = parseRegistrationCSV(csv)
    expect(result.valid).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(1)
    expect(result.errors[0].message).toContain('last_name')
  })

  it('handles empty CSV', () => {
    const result = parseRegistrationCSV('')
    expect(result.valid).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('detects duplicate competitor numbers in same competition', () => {
    const csv = `first_name,last_name,competitor_number,age_group,level,competition_code,competition_name
Siobhan,Murphy,101,U12,Beginner,B-U12-R1,Beginner U12 Reel
Aoife,Kelly,101,U12,Beginner,B-U12-R1,Beginner U12 Reel`

    const result = parseRegistrationCSV(csv)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toContain('duplicate')
  })

  it('parses CSV without competitor_number column', () => {
    const csv = `first_name,last_name,age_group,level,competition_code,competition_name
Siobhan,Murphy,U12,Beginner,B-U12-R1,Beginner U12 Reel
Aoife,Kelly,U12,Beginner,B-U12-R1,Beginner U12 Reel`

    const result = parseRegistrationCSV(csv)
    expect(result.valid).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(result.valid[0].competitor_number).toBeUndefined()
    expect(result.valid[0].first_name).toBe('Siobhan')
  })

  it('does not warn about duplicate numbers when competitor_number is absent', () => {
    const csv = `first_name,last_name,age_group,level,competition_code,competition_name
Siobhan,Murphy,U12,Beginner,B-U12-R1,Beginner U12 Reel
Aoife,Kelly,U12,Beginner,B-U12-R1,Beginner U12 Reel`

    const result = parseRegistrationCSV(csv)
    expect(result.warnings.filter(w => w.message.includes('duplicate'))).toHaveLength(0)
  })

  it('parses optional fields: date_of_birth, teacher_name, dance_type', () => {
    const csv = `first_name,last_name,age_group,level,competition_code,competition_name,date_of_birth,school_name,teacher_name,dance_type
Siobhan,Murphy,U12,Beginner,B-U12-R1,Beginner U12 Reel,2014-03-15,Murphy Academy,Colm Murphy,reel`

    const result = parseRegistrationCSV(csv)
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0].date_of_birth).toBe('2014-03-15')
    expect(result.valid[0].teacher_name).toBe('Colm Murphy')
    expect(result.valid[0].dance_type).toBe('reel')
    expect(result.valid[0].school_name).toBe('Murphy Academy')
  })

  it('ignores unknown columns without error', () => {
    const csv = `first_name,last_name,age_group,level,competition_code,competition_name,some_random_column
Siobhan,Murphy,U12,Beginner,B-U12-R1,Beginner U12 Reel,whatever`

    const result = parseRegistrationCSV(csv)
    expect(result.valid).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })

  it('warns when same name appears with different schools', () => {
    const csv = `first_name,last_name,competitor_number,age_group,level,competition_code,competition_name,school_name
Siobhan,Murphy,101,U12,Beginner,B-U12-R1,Beginner U12 Reel,Murphy Academy
Siobhan,Murphy,202,U14,Novice,N-U14-R1,Novice U14 Reel,Celtic Stars`

    const result = parseRegistrationCSV(csv)
    expect(result.warnings.some(w => w.message.includes('same name'))).toBe(true)
  })
})
