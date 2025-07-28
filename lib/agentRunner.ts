// /lib/agentRunner.ts

export async function runAgent(
  agentId: string,
  input_variables: Record<string, any>,
  override_user_prompt?: string
) {
  const res = await fetch('/api/run-agent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id: agentId,
      input_variables, // ✅ MAKE SURE THIS IS PASSED
      override_user_prompt,
    }),
  })

  if (!res.ok) {
    throw new Error(`Agent run failed: ${res.statusText}`)
  }

  return await res.json()
}