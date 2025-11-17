import { getPluginConnection } from '@/lib/plugins/helpers/getPluginConnection'

export async function readInbox(
  userId: string,
  options: { maxResults?: number; label?: string } = {}
): Promise<string> {
  console.log('📥 readInbox called with userId:', userId, 'options:', options)

  const pluginKey = 'google-mail'

  // Get connection with auto-refresh
  const connection = await getPluginConnection(userId, pluginKey)
  const access_token = connection.access_token

  const maxResults = options?.maxResults ?? 5
  const labelInput = options?.label?.trim() || 'INBOX'
  const label = labelInput.toUpperCase() === 'INBOX' ? 'INBOX' : labelInput

  console.log('📬 Fetching from Gmail: maxResults =', maxResults, 'label =', label)

  // 1. Get message IDs
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=${label}`,
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  )

  if (!listRes.ok) {
    const errText = await listRes.text()
    throw new Error(`❌ Failed to list inbox messages: ${errText}`)
  }

  let { messages = [] } = await listRes.json()
  if (messages.length === 0) return '📭 No messages found.'

  // 2. Fetch each message and extract summary
  const summaries: string[] = []

  for (const msg of messages) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Snippet`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    )

    if (!msgRes.ok) continue

    const msgData = await msgRes.json()
    const headers: Record<string, string> = {}

    msgData.payload?.headers?.forEach((h: { name: string; value: string }) => {
      headers[h.name] = h.value
    })

    summaries.push(
      `From: ${headers['From'] || 'Unknown'}\nSubject: ${headers['Subject'] || 'No subject'}`
    )

    if (summaries.length >= maxResults) break
  }

  return summaries.join('\n\n')
}