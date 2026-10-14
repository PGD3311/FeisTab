/**
 * Builds the invitation email. Pure — sending happens in send-email.ts.
 */

import { type EventRole } from '@/lib/auth/require-role'
import { INVITE_ROLE_PHRASES } from '@/lib/invitations'

export interface InviteEmailInput {
  feisName: string
  feisDate: string | null
  role: EventRole
  judgeName: string | null
  url: string
}

export interface InviteEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatFeisDate(date: string | null): string | null {
  if (!date) return null
  const parsed = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function buildInviteEmail(input: InviteEmailInput): InviteEmail {
  const phrase = INVITE_ROLE_PHRASES[input.role]
  const date = formatFeisDate(input.feisDate)
  const subject = `You're invited to ${phrase} ${input.feisName}`
  const judgeLine = input.judgeName ? `You'll be judging as ${input.judgeName}.` : null

  const text = [
    `You're invited to ${phrase} ${input.feisName}${date ? ` on ${date}` : ''}.`,
    judgeLine,
    '',
    'Open this link to set your password. It takes you straight to your screen for the day:',
    input.url,
    '',
    "If you weren't expecting this, you can ignore this email.",
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  const feis = escapeHtml(input.feisName)
  const url = escapeHtml(input.url)

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#E8ECE9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#E8ECE9;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr>
    <td style="background-color:#0B4D2C;padding:24px 40px;text-align:center;">
      <p style="margin:0;font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:0.5px;">FeisTab</p>
    </td>
  </tr>
  <tr>
    <td style="background-color:#FFFFFF;padding:36px 40px 8px;">
      <p style="margin:0 0 6px;font-size:15px;color:#4B5563;">You're invited to ${escapeHtml(phrase)}</p>
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:700;color:#1A1D23;line-height:1.25;">${feis}</h1>
      ${date ? `<p style="margin:0 0 20px;font-size:15px;color:#4B5563;">${escapeHtml(date)}</p>` : ''}
      ${judgeLine ? `<p style="margin:0 0 20px;font-size:16px;color:#1A1D23;">${escapeHtml(judgeLine)}</p>` : ''}
      <p style="margin:0 0 28px;font-size:16px;color:#4B5563;line-height:1.6;">
        Set your password and you'll go straight to your screen for the day.
      </p>
    </td>
  </tr>
  <tr>
    <td style="background-color:#FFFFFF;padding:0 40px 32px;text-align:center;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td style="background-color:#0B4D2C;border-radius:6px;">
            <a href="${url}" target="_blank" style="display:inline-block;padding:18px 48px;font-size:17px;font-weight:600;color:#FFFFFF;text-decoration:none;">
              Accept invitation
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="background-color:#FFFFFF;padding:0 40px 32px;border-top:1px solid #E5E7EB;">
      <p style="margin:20px 0 0;font-size:13px;color:#6B7280;line-height:1.6;">
        Button not working? Paste this link into your browser:<br>
        <a href="${url}" style="color:#0B4D2C;word-break:break-all;">${url}</a>
      </p>
      <p style="margin:12px 0 0;font-size:13px;color:#9CA3AF;">
        If you weren't expecting this, you can ignore this email.
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`

  return { subject, html, text }
}
