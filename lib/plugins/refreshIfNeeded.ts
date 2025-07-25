// ✅ Client-safe version (from earlier)
export async function refreshIfNeeded(userId: string, pluginKey: string) {
  const res = await fetch(`/api/plugins/${pluginKey}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Failed to refresh plugin ${pluginKey}: ${errorText}`)
  }

  const { pluginData } = await res.json()
  return pluginData
}