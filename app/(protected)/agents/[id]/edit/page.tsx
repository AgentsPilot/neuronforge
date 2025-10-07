// app/(protected)/agents/[id]/edit/page.tsx
'use client'

import { useParams } from 'next/navigation'
import EditAgentWrapper from '@/components/agent-creation/EditAgentWrapper'

export default function EditAgentPage() {
  const params = useParams()
  const agentId = params?.id as string

  if (!agentId) {
    return <p className="text-center mt-10 text-red-600">Invalid agent ID.</p>
  }

  return <EditAgentWrapper agentId={agentId} />
}