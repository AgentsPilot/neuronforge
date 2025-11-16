import { getPluginConnection } from '@/lib/plugins/helpers/getPluginConnection'
import { generatePDF } from '@/lib/pdf/generatePDF'

type SendEmailOptions = {
  userId: string
  to: string
  subject: string
  body: string
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
  includePdf = false,
}: SendEmailOptions) {
  const pluginKey = 'google-mail'

  // Get connection with auto-refresh
  const connection = await getPluginConnection(userId, pluginKey)
  const access_token = connection.access_token
  const htmlBody = wrapInHtml(body)

  if (!includePdf) {
    const rawEmail = [
      `To: ${to}`,
      'Content-Type: text/html; charset=utf-8',
      `Subject: ${subject}`,
      '',
      htmlBody,
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

  // ✅ Generate PDF and encode as base64 correctly
  const pdfData = generatePDF(subject, { content: body }) // should return Uint8Array or ArrayBuffer
  const uint8Array = new Uint8Array(pdfData)
  const pdfBase64 = Buffer.from(uint8Array).toString('base64')

  const boundary = '__boundary__'
  const mimeMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    htmlBody,
    '',
    `--${boundary}`,
    'Content-Type: application/pdf; name="output.pdf"',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="output.pdf"',
    '',
    pdfBase64,
    '',
    `--${boundary}--`,
  ].join('\n')

  const encodedMime = encodeBase64(mimeMessage)

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedMime }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to send email with PDF: ${errorText}`)
  }

  return await response.json()
}