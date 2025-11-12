// components/v2/HelpBot.tsx
// Floating AI-powered help bot for contextual assistance

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/UserProvider'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface PageContext {
  title: string
  description: string
  helpTopics: string[]
}

// Page-specific context for better help responses
const PAGE_CONTEXTS: Record<string, PageContext> = {
  '/v2/dashboard': {
    title: 'Dashboard',
    description: 'Overview of your agents, credits, and activity',
    helpTopics: [
      'How do I view my agent statistics?',
      'What do the credit metrics mean?',
      'How do I create a new agent?',
    ],
  },
  '/v2/agent-list': {
    title: 'Agent List',
    description: 'Manage and monitor all your agents',
    helpTopics: [
      'How do I filter agents?',
      'What are agent statuses?',
      'How do I edit an agent?',
    ],
  },
  '/v2/analytics': {
    title: 'Analytics',
    description: 'Track performance and costs',
    helpTopics: [
      'How do I interpret the cost breakdown?',
      'What metrics are tracked?',
      'How do I export analytics data?',
    ],
  },
  '/v2/billing': {
    title: 'Billing',
    description: 'Manage your subscription and credits',
    helpTopics: [
      'How do I add more credits?',
      'What are Pilot Credits?',
      'How is usage calculated?',
    ],
  },
  '/v2/settings': {
    title: 'Settings',
    description: 'Configure your account and preferences',
    helpTopics: [
      'How do I change my API keys?',
      'How do I manage integrations?',
      'How do I update my profile?',
    ],
  },
}

// Helper function to render markdown-style text with interactive links
function renderMarkdown(text: string) {
  // Convert **bold** to <strong>
  let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  // Convert markdown links [text](url) to clickable links
  // Internal links (starting with /) get a special class for in-app navigation
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      if (url.startsWith('/')) {
        // Internal link - will be handled by router
        return `<a href="${url}" class="text-blue-500 hover:underline font-medium cursor-pointer internal-link" data-path="${url}">${linkText}</a>`
      } else if (url.startsWith('http')) {
        // External link
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline font-medium">${linkText}</a>`
      }
      return match
    }
  )

  // Convert plain URLs to external links (if any remain)
  processed = processed.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">$1</a>'
  )

  return processed
}

export function HelpBot() {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Get current page context
  const pageContext = PAGE_CONTEXTS[pathname] || {
    title: 'NeuronForge',
    description: 'AI Agent Platform',
    helpTopics: ['How do I get started?', 'What can I do here?'],
  }

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Initialize with welcome message when opened
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: `Hi! I'm your **${pageContext.title}** assistant. I can help you with:\n\n${pageContext.helpTopics.map((topic, i) => `${i + 1}. ${topic}`).join('\n')}\n\nWhat would you like to know?`,
        },
      ])
    }
  }, [isOpen])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Call help bot API with user context
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      // Add user ID to headers if authenticated
      if (user?.id) {
        headers['x-user-id'] = user.id
      }

      const response = await fetch('/api/help-bot', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [...messages, userMessage],
          pageContext: {
            ...pageContext,
            path: pathname, // Include current path for keyword matching
          },
        }),
      })

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error)
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Help bot error:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "I'm having trouble connecting right now. Please try again or contact support.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleQuickQuestion = (question: string) => {
    setInput(question)
  }

  // Handle clicks on internal links in bot messages
  const handleMessageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'A' && target.classList.contains('internal-link')) {
      e.preventDefault()
      const path = target.getAttribute('data-path')
      if (path) {
        router.push(path)
        setIsOpen(false) // Close help bot after navigation
      }
    }
  }

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-[var(--v2-primary)] text-white rounded-full shadow-lg hover:scale-110 transition-transform duration-200 flex items-center justify-center z-50"
          title="Help & Support"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-[var(--v2-surface)] shadow-2xl z-50 flex flex-col border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--v2-border)] bg-[var(--v2-primary)] text-white">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              <div>
                <div className="font-semibold text-sm">{pageContext.title} Help</div>
                <div className="text-xs opacity-90">Ask me anything</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-white/20 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4" onClick={handleMessageClick}>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-lg ${
                    message.role === 'user'
                      ? 'bg-[var(--v2-primary)] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-[var(--v2-text-primary)]'
                  }`}
                  style={{
                    borderRadius: message.role === 'user' ? '12px 12px 0 12px' : '12px 12px 12px 0',
                  }}
                >
                  <div
                    className="text-sm whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{
                      __html: message.role === 'assistant' ? renderMarkdown(message.content) : message.content
                    }}
                  />
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-lg rounded-bl-none">
                  <Loader2 className="w-5 h-5 text-[var(--v2-primary)] animate-spin" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Questions */}
          {messages.length === 1 && (
            <div className="px-4 py-2 border-t border-[var(--v2-border)] bg-gray-50 dark:bg-gray-900/30">
              <div className="text-xs text-[var(--v2-text-muted)] mb-2">Quick questions:</div>
              <div className="flex flex-wrap gap-2">
                {pageContext.helpTopics.slice(0, 2).map((topic, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuickQuestion(topic)}
                    className="text-xs px-2 py-1 bg-white dark:bg-gray-800 border border-[var(--v2-border)] rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-[var(--v2-border)]">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask a question..."
                className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
