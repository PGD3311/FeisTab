import { describe, it, expect } from 'vitest'
import {
  inviteDestination,
  judgeLoginStatus,
  inviteState,
  inviteUrl,
  isEventRole,
  normalizeInviteEmail,
} from '@/lib/invitations'
import { buildInviteEmail } from '@/lib/email/invite-email'

describe('inviteDestination', () => {
  it('sends each role straight to its screen for the event', () => {
    expect(inviteDestination('judge', 'e1')).toBe('/judge/e1')
    expect(inviteDestination('registration_desk', 'e1')).toBe('/registration/e1')
    expect(inviteDestination('side_stage', 'e1')).toBe('/checkin/e1')
    expect(inviteDestination('organizer', 'e1')).toBe('/dashboard/events/e1')
  })
})

describe('inviteState', () => {
  const now = new Date('2026-10-14T12:00:00Z')

  it('is open before it expires', () => {
    expect(inviteState({ accepted_at: null, expires_at: '2026-10-20T00:00:00Z' }, now)).toBe('open')
  })

  it('is expired at or after expires_at', () => {
    expect(inviteState({ accepted_at: null, expires_at: '2026-10-14T12:00:00Z' }, now)).toBe(
      'expired'
    )
  })

  it('stays accepted even after the expiry date', () => {
    expect(
      inviteState({ accepted_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-02T00:00:00Z' }, now)
    ).toBe('accepted')
  })
})

describe('inviteUrl', () => {
  it('builds the link without a doubled slash', () => {
    expect(inviteUrl('https://feistab.vercel.app/', 'abc')).toBe(
      'https://feistab.vercel.app/auth/invite/abc'
    )
  })
})

describe('normalizeInviteEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeInviteEmail('  Bridget@Example.COM ')).toBe('bridget@example.com')
  })

  it('rejects things that are not email addresses', () => {
    expect(normalizeInviteEmail('bridget')).toBeNull()
    expect(normalizeInviteEmail('a b@example.com')).toBeNull()
    expect(normalizeInviteEmail('')).toBeNull()
  })
})

describe('isEventRole', () => {
  it('accepts the four event roles only', () => {
    expect(isEventRole('judge')).toBe(true)
    expect(isEventRole('side_stage')).toBe(true)
    expect(isEventRole('admin')).toBe(false)
  })
})

describe('buildInviteEmail', () => {
  const base = {
    feisName: 'Newport Feis',
    feisDate: '2026-11-07',
    url: 'https://feistab.vercel.app/auth/invite/abc',
  }

  it('names the feis, role and judge', () => {
    const email = buildInviteEmail({ ...base, role: 'judge', judgeName: 'Bridget Murphy' })
    expect(email.subject).toBe("You're invited to judge at Newport Feis")
    expect(email.text).toContain('Saturday, November 7, 2026')
    expect(email.text).toContain("You'll be judging as Bridget Murphy.")
    expect(email.text).toContain(base.url)
    expect(email.html).toContain(base.url)
  })

  it('leaves out the judge line for volunteers', () => {
    const email = buildInviteEmail({ ...base, role: 'side_stage', judgeName: null })
    expect(email.subject).toBe("You're invited to run side-stage at Newport Feis")
    expect(email.text).not.toContain('judging as')
  })

  it('escapes HTML in names', () => {
    const email = buildInviteEmail({
      ...base,
      feisName: 'O<Brien> & Sons Feis',
      role: 'judge',
      judgeName: null,
    })
    expect(email.html).toContain('O&lt;Brien&gt; &amp; Sons Feis')
    expect(email.html).not.toContain('O<Brien>')
  })

  it('handles a missing date', () => {
    const email = buildInviteEmail({ ...base, feisDate: null, role: 'organizer', judgeName: null })
    expect(email.text.split('\n')[0]).toBe("You're invited to help organize Newport Feis.")
  })
})

describe('judgeLoginStatus', () => {
  const judge = { id: 'j1', user_id: null }
  it('is paper only with no user and no invites', () => {
    expect(judgeLoginStatus(judge, [])).toBe('paper_only')
    expect(judgeLoginStatus(judge, [{ judge_id: 'j2', accepted_at: null }])).toBe('paper_only')
  })
  it('is invited with a pending invite linked to the judge', () => {
    expect(judgeLoginStatus(judge, [{ judge_id: 'j1', accepted_at: null }])).toBe('invited')
  })
  it('can sign in with a linked user or an accepted invite', () => {
    expect(judgeLoginStatus({ id: 'j1', user_id: 'u1' }, [])).toBe('can_sign_in')
    expect(judgeLoginStatus(judge, [{ judge_id: 'j1', accepted_at: '2026-10-01' }])).toBe(
      'can_sign_in'
    )
  })
})
