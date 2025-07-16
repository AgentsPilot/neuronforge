import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: agents, error } = await supabase
    .from('agents')
    .select('*')
    .eq('mode', 'scheduled')

  if (error) {
    console.error(error)
    return new Response('Failed to fetch agents', { status: 500 })
  }

  for (const agent of agents || []) {
    try {
      const now = new Date()
      const lastRun = agent.last_run_at ? new Date(agent.last_run_at) : new Date(0)
      const minutesSince = (now.getTime() - lastRun.getTime()) / (1000 * 60)

      if (minutesSince >= 1) {
        await fetch(`${Deno.env.get('AGENT_RUN_API_URL')}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('AGENT_API_KEY')}`
          },
          body: JSON.stringify({ agent_id: agent.id })
        })

        await supabase
          .from('agents')
          .update({ last_run_at: now.toISOString() })
          .eq('id', agent.id)
      }
    } catch (err) {
      console.error(`Failed to run agent ${agent.id}`, err)
    }
  }

  return new Response('Scheduled agents executed', { status: 200 })
})