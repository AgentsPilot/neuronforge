// lib/plugins/actions/gmail/readInbox.ts

import { refreshIfNeeded } from '@/lib/plugins/refreshIfNeeded'

export async function readInbox(userId: string): Promise<string> {
  console.log('📥 readInbox called with userId:', userId)

  const pluginKey = 'google-mail'
  const { access_token } = await refreshIfNeeded(userId, pluginKey)

  // 1. Fetch list of recent message IDs
  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5',
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  )

  if (!listRes.ok) {
    const errText = await listRes.text()
    throw new Error(`Failed to list inbox messages: ${errText}`)
  }

  const { messages = [] } = await listRes.json()

  // 2. Fetch metadata for each message
  const formattedEmails = await Promise.all(
    messages.map(async (msg: { id: string }) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      )

      if (!msgRes.ok) {
        return `⚠️ Failed to load message ${msg.id}`
      }

      const msgData = await msgRes.json()

      const headers: Record<string, string> = {}
      msgData.payload.headers.forEach((h: { name: string; value: string }) => {
        headers[h.name] = h.value
      })

      return `From: ${headers['From'] || 'Unknown'}\nSubject: ${headers['Subject'] || 'No subject'}`
    })
  )

  return formattedEmails.join('\n\n')
}