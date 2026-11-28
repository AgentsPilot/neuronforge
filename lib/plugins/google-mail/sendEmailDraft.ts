import { getPluginConnection } from '@/lib/plugins/helpers/getPluginConnection'
import { checkOutboundRecipients, RECIPIENT_REFUSED_MESSAGE } from '@/lib/email/recipientAllowList'
import { alertBlockedEmail } from '@/lib/email/blockedEmailAlert'

type SendEmailOptions = {
  userId: string
  to: string
  subject: string
  body: string
  /**
   * D12 follow-up: accepted for backward compatibility with existing callers
   * (e.g. EmailHandler forwards `outputSchema.includePdf`) but NO LONGER honored.
   * The former PDF-attachment path relied on `generatePDF`, which is a void stub
   * that never produced a PDF — it built a `multipart/mixed` message with an
   * empty/garbage attachment. That dead branch was removed; every send now goes
   * through the working `multipart/alternative` (HTML + plaintext) path below.
   */
  includePdf?: boolean
}

function encodeBase64(str: string) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function wrapInHtml(content: string) {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        ${content
          .split('\n')
          .map((line) => `<p>${line.trim()}</p>`)
          .join('')}
      </body>
    </html>
  `
}

export async function sendEmailDraft({
  userId,
  to,
  subject,
  body,
}: SendEmailOptions) {
  const pluginKey = 'google-mail'

  // PROD-1b (A7): the recipient guard, before the connection is even read. The
  // only caller (EmailHandler) catches this and reports emailSent: false; it
  // does not retry. The message names no address.
  if (!checkOutboundRecipients([to]).allowed) {
    // PROD-1 S3.3c: tell the admins (throttled, masked, never throws).
    await alertBlockedEmail({ source: 'gmail', action: 'send_draft', recipients: [to] })
    throw new Error(RECIPIENT_REFUSED_MESSAGE)
  }

  // Get connection with auto-refresh
  const connection = await getPluginConnection(userId, pluginKey)
  const access_token = connection.access_token
  const htmlBody = wrapInHtml(body)

  // D12: send multipart/alternative (text/plain + text/html) instead of single-part
  // text/html. The plaintext part is the original `body` (this sender receives
  // plaintext and wraps it into HTML via wrapInHtml), so no discarded plaintext.
  const altBoundary = '__np_alt_boundary__'
  const rawEmail = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    htmlBody,
    '',
    `--${altBoundary}--`,
  ].join('\n')

  const encodedEmail = encodeBase64(rawEmail)

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedEmail }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to send email: ${errorText}`)
  }

  return await response.json()
}
