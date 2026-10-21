// Server-only. Sends through Resend's HTTP API when RESEND_API_KEY is set.

export type SendEmailResult =
  | { sent: true }
  | { sent: false; reason: 'not_configured' | 'failed'; message?: string }

export async function sendEmail(params: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: 'not_configured' }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'RunFeis <noreply@runfeis.com>',
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[email] Resend rejected the message (${res.status}): ${body}`)
      return { sent: false, reason: 'failed', message: `Email service returned ${res.status}` }
    }
    return { sent: true }
  } catch (err) {
    console.error('[email] Failed to reach Resend:', err)
    return { sent: false, reason: 'failed', message: 'Could not reach the email service' }
  }
}
