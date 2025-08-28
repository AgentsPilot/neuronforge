// lib/plugins/refreshIfNeeded.ts

export async function refreshIfNeeded(userId: string, pluginKey: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  console.log('🔁 Calling refresh for plugin:', pluginKey, 'with userId:', userId)

  const res = await fetch(`${baseUrl}/api/plugins/${pluginKey}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }) // ✅ send only the raw string
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Failed to refresh plugin: ${errText}`)
  }

  const { pluginData } = await res.json()
  return pluginData
}