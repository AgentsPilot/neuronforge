'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'

export default function AgentPromptBar() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return

    setLoading(true)
    try {
      const encodedPrompt = encodeURIComponent(prompt.trim())
      router.push(`/agents/new?prompt=${encodeURIComponent(prompt)}`)
    } catch (err) {
      console.error('🚨 Redirect failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-3xl mx-auto px-4 py-3 bg-white dark:bg-muted border border-gray-200 dark:border-gray-700 rounded-full shadow-md flex items-center gap-3"
    >
      <Input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what you want your agent to do..."
        className="flex-1 border-none focus:ring-0 bg-transparent placeholder-gray-400 text-sm"
        disabled={loading}
      />
      <Button
        type="submit"
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-full transition"
      >
        <Sparkles className="w-4 h-4 mr-1" />
        Generate
      </Button>
    </form>
  )
}