// /app/(protected)/agents/new/chat/page.tsx
'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import AgentBuilderIntegration from '@/components/agent-creation/AgentBuilderIntegration' // CHANGED
import { useRouter } from 'next/navigation' // ADD THIS

function ChatPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter() // ADD THIS
  const initialPrompt = searchParams.get('prompt')
  const { user } = useAuth()

  // Debug logging
  useEffect(() => {
    console.log('🔍 ChatPageContent mounted')
    console.log('🔍 searchParams:', Object.fromEntries(searchParams.entries()))
    console.log('🔍 initialPrompt from URL:', initialPrompt)
    console.log('🔍 user:', user ? { id: user.id, email: user.email } : 'No user')
  }, [searchParams, initialPrompt, user])

  // ADD THESE HANDLERS
  const handleAgentCompleted = (agent: any) => {
    console.log('🎉 Agent creation completed:', {
      agentId: agent.id,
      agentName: agent.agent_name,
      userId: user?.id
    });
    router.push(`/agents/${agent.id}`);
  };

  const handleCancel = () => {
    console.log('❌ Agent building cancelled');
    router.push('/agents');
  };

  if (!user) {
    console.log('❌ No user found, showing login prompt')
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Please log in to use the agent builder.</p>
        </div>
      </div>
    )
  }

  console.log('✅ Rendering AgentBuilderIntegration with:', {
    initialPrompt,
    userId: user.id
  })

  return (
    <div className="min-h-screen">
      <AgentBuilderIntegration
        initialPrompt={initialPrompt || undefined}
        onAgentCompleted={handleAgentCompleted}
        onCancel={handleCancel}
      />
    </div>
  )
}

export default function NewAgentChatPage() {
  console.log('🏗️ NewAgentChatPage component rendered')
  
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading conversational agent builder...</p>
        </div>
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  )
}