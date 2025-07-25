export async function runAgent(agentId: string, input: Record<string, any>, userPrompt: string) {
  const response = await fetch('/api/run-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: agentId,
      input,
      user_prompt: userPrompt,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to run agent: ${error}`)
  }

  const result = await response.json()
  return result // ✅ Return what your backend sends (should include { output: ... })
}