import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export function useAgents() {
  const [agents, setAgents] = useState<any[]>([])

  useEffect(() => {
    async function loadAgents() {
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name')
        .order('created_at', { ascending: false })

      if (!error) setAgents(data || [])
    }

    loadAgents()
  }, [])

  return { agents }
}