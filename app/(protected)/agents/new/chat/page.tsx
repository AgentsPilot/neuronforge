'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import ConversationalAgentBuilder from '@/components/agent-creation/ConversationalAgentBuilder'

function ChatPageContent() {
  const searchParams = useSearchParams()
  const initialPrompt = searchParams.get('prompt')
  const { user } = useAuth()

  // Debug logging to see what's happening
  useEffect(() => {
    console.log('🔍 ChatPageContent mounted')
    console.log('🔍 searchParams:', Object.fromEntries(searchParams.entries()))
    console.log('🔍 initialPrompt from URL:', initialPrompt)
    console.log('🔍 user:', user ? { id: user.id, email: user.email } : 'No user')
  }, [searchParams, initialPrompt, user])

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

  console.log('✅ Rendering ConversationalAgentBuilder with:', {
    initialPrompt,
    userId: user.id
  })

  return (
    <div className="min-h-screen">
      <ConversationalAgentBuilder 
        initialPrompt={initialPrompt || undefined}
        userId={user.id}
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