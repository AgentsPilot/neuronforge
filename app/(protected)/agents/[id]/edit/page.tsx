// app/(protected)/agents/[id]/edit/page.tsx

'use client'

import { useParams } from 'next/navigation'
import AgentWizard from '@/components/AgentWizard'

export default function EditAgentPage() {
  const params = useParams()
  const agentId = params?.id as string

  if (!agentId) {
    return <p className="text-center mt-10 text-red-600">Invalid agent ID.</p>
  }

  return <AgentWizard agentId={agentId} />
}