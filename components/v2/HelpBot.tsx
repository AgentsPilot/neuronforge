'use client'

import React, { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { MessageCircle, X, Send, Loader2, ThumbsUp, ThumbsDown, BookOpen, Database, Zap, Sparkles } from 'lucide-react'
import { useAuth } from '@/components/UserProvider'

interface Message {
  role: 'user' | 'assistant'
  content: string
  source?: 'FAQ' | 'Cache' | 'Groq' | 'AgentSearch'
  cacheId?: string
  feedbackGiven?: 'up' | 'down' | null
}

interface PageContext {
  title: string
  description: string
  helpTopics: string[]
}

const PAGE_CONTEXTS: Record<string, PageContext> = {
  '/v2/dashboard': { title: 'Dashboard', description: 'Overview of your agents, credits, and activity', helpTopics: ['How do I view my agent statistics?', 'What do the credit metrics mean?', 'How do I create a new agent?'] },
  '/v2/agent-list': { title: 'Agent List', description: 'Manage and monitor all your agents', helpTopics: ['How do I filter agents?', 'What are agent statuses?', 'How do I edit an agent?'] },
  '/v2/analytics': { title: 'Analytics', description: 'Track performance and costs', helpTopics: ['How do I interpret the cost breakdown?', 'What metrics are tracked?', 'How do I export analytics data?'] },
  '/v2/billing': { title: 'Billing', description: 'Manage your subscription and credits', helpTopics: ['How do I add more credits?', 'What are Pilot Credits?', 'How is usage calculated?'] },
  '/v2/settings': { title: 'Settings', description: 'Configure your account and preferences', helpTopics: ['How do I change my API keys?', 'How do I manage integrations?', 'How do I update my profile?'] },
  '/v2/agents/new': { title: 'Create Agent', description: 'Build a new AI agent with conversational builder', helpTopics: ['How does the agent builder work?', 'What information do I need to provide?', 'Can I test my agent before saving?'] },
}

// ---- ADDED TYPES FOR FIELD-SPECIFIC HELP ----
interface InputHelpContext {
  mode: 'input_help'
  agentId: string
  fieldName: string
  plugin?: string
  expectedType?: string
}
type HelpBotProps = {
  isOpen?: boolean
  context?: InputHelpContext
  onFill?: (value: string) => void
  onClose?: () => void
}
// ---------------------------------------------

function renderMarkdown(text: string) {
  let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-[var(--v2-text-primary)]">$1</strong>')
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      if (url.startsWith('/')) return `<a class="text-[var(--v2-primary)] hover:underline font-medium cursor-pointer internal-link transition-colors" data-path="${url}">${linkText}</a>`
      else if (url.startsWith('http')) return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-[var(--v2-primary)] hover:underline font-medium transition-colors">${linkText}</a>`
      return match
    }
  )
  processed = processed.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-[var(--v2-primary)] hover:underline">$1</a>'
  )
  return processed
}

// ---- MAIN COMPONENT ----
export function HelpBot(props: HelpBotProps) {
  const { isOpen: controlledOpen, context, onFill, onClose } = props
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  // Internally controlled vs modal modes
  const [isOpenInternal, setIsOpenInternal] = useState(false)
  const isInputHelp = !!context && context.mode === 'input_help'
  const isOpen = controlledOpen !== undefined ? controlledOpen : isOpenInternal

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const pageContext = PAGE_CONTEXTS[pathname] || {
    title: 'NeuronForge', description: 'AI Agent Platform', helpTopics: [
      'How do I get started?', 'What can I do here?'],
  }

  // ---- MODAL/FIELD-HELP WELCOME & CONTEXT ----
  useEffect(() => {
    if (!isOpen) return
    if (isInputHelp) {
      setMessages([
        {
          role: 'assistant',
          content: `I'm here to help you fill the field **${context?.fieldName}**. Just send me the link or info, I’ll extract only what’s needed and fill it for you!`,
        },
      ])
    } else if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: `Hi! I'm your **${pageContext.title}** assistant. I can help you with:\n\n${pageContext.helpTopics.map((topic, i) => `${i + 1}. ${topic}`).join('\n')}\n\nWhat would you like to know?`,
        },
      ])
    }
    // eslint-disable-next-line
  }, [isOpen, isInputHelp, context])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // ---- SEND HANDLER: PASSES SPECIAL CONTEXT IF PRESENT, DETECTS FILL ACTION ----
  const handleSend = async () => {
    if (!input.trim() || isLoading) return
    const userMessage: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user?.id) headers['x-user-id'] = user.id
      const body = isInputHelp
        ? { messages: [...messages, userMessage], context }
        : { messages: [...messages, userMessage], pageContext: { ...pageContext, path: pathname } }
      const response = await fetch('/api/help-bot-v2', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error)
      // ---- SPECIAL FILL HANDLER ----
      try {
        const maybeJSON = typeof data.response === 'string' ? JSON.parse(data.response) : null
        if (
          maybeJSON &&
          maybeJSON.action === 'fill_agent_input' &&
          maybeJSON.value &&
          typeof onFill === 'function' &&
          isInputHelp
        ) {
          onFill(maybeJSON.value)
          if (onClose) onClose()
        }
      } catch { /* ignore parse errors */ }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.response,
          source: data.source,
          cacheId: data.cacheId,
          feedbackGiven: null,
        },
      ])
    } catch (error) {
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

  const handleQuickQuestion = (question: string) => { setInput(question) }

  const handleFeedback = async (messageIndex: number, feedbackType: 'up' | 'down') => {
    const message = messages[messageIndex]
    if (!message.cacheId || message.feedbackGiven === feedbackType) return
    try {
      await fetch('/api/help-bot-v2/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheId: message.cacheId, feedbackType }),
      })
      setMessages((prev) =>
        prev.map((msg, idx) => (idx === messageIndex ? { ...msg, feedbackGiven: feedbackType } : msg))
      )
    } catch (error) { }
  }

  const getSourceBadge = (source?: string) => {
    if (!source) return null
    const badges = {
      FAQ: { icon: BookOpen, label: 'FAQ', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
      Cache: { icon: Database, label: 'Cache', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
      Groq: { icon: Zap, label: 'AI', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
      AgentSearch: { icon: MessageCircle, label: 'Search', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20' },
    }
    const badge = badges[source as keyof typeof badges]
    if (!badge) return null
    const Icon = badge.icon
    return (
      <div className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${badge.bg} ${badge.color} font-medium mt-1.5`}>
        <Icon className="w-3 h-3" />
        <span>{badge.label}</span>
      </div>
    )
  }

  const handleMessageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'A' && target.classList.contains('internal-link')) {
      e.preventDefault()
      const path = target.getAttribute('data-path')
      if (path) {
        router.push(path)
        if (typeof onClose === 'function') onClose()
        setIsOpenInternal(false)
      }
    }
  }

  return (
    <>
      {/* ---- FLOATING BUTTON: hides in modal/input_help mode ---- */}
      {!isOpen && !controlledOpen && !isInputHelp && (
        <button
          onClick={() => setIsOpenInternal(true)}
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-[var(--v2-primary)] to-purple-600 text-white shadow-[var(--v2-shadow-card)] hover:shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center z-50 group"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
          title="Help & Support"
        >
          <MessageCircle className="w-6 h-6 sm:w-7 sm:h-7 group-hover:rotate-12 transition-transform duration-300" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 animate-pulse"></div>
          <Sparkles className="absolute top-1 right-1 w-3 h-3 text-yellow-300 animate-pulse" />
        </button>
      )}

      {(isOpen || (isInputHelp && context)) && (
        <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 w-[calc(100vw-2rem)] sm:w-[440px] h-[calc(100vh-8rem)] sm:h-[680px] max-h-[calc(100vh-2rem)] bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] z-50 flex flex-col border border-[var(--v2-border)] backdrop-blur-xl animate-in slide-in-from-bottom-4 duration-300" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--v2-border)]/50 bg-gradient-to-r from-[var(--v2-primary)] via-purple-600 to-[var(--v2-primary)] text-white backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ring-white/30 shadow-lg">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-white shadow-sm animate-pulse"></div>
              </div>
              <div>
                <div className="font-semibold text-sm sm:text-base tracking-tight">
                  {isInputHelp ? `Help With: ${context?.fieldName}` : `${pageContext.title} Assistant`}
                </div>
                <div className="text-xs opacity-90 flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="font-medium">Online now</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => { if (onClose) onClose(); setIsOpenInternal(false); }}
              className="p-2 hover:bg-white/20 rounded-lg transition-all duration-200 active:scale-95 backdrop-blur-sm"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 bg-gradient-to-b from-gray-50/50 to-transparent dark:from-gray-900/20" onClick={handleMessageClick}>
            {messages.map((message, index) => (
              <div key={index} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                <div className={`max-w-[85%] sm:max-w-[80%] px-4 py-3 shadow-sm ${
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-[var(--v2-primary)] to-purple-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-[var(--v2-text-primary)] border border-[var(--v2-border)]'
                }`}
                  style={{
                    borderRadius: message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  }}>
                  <div
                    className={`text-sm leading-relaxed ${message.role === 'user' ? 'text-white' : ''}`}
                    dangerouslySetInnerHTML={{
                      __html: message.role === 'assistant' ? renderMarkdown(message.content) : message.content
                    }}
                  />
                  {message.role === 'assistant' && message.source && (
                    <div className="mt-2">
                      {getSourceBadge(message.source)}
                    </div>
                  )}
                </div>
                {message.role === 'assistant' && message.cacheId && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      onClick={() => handleFeedback(index, 'up')}
                      className={`p-1.5 rounded-lg transition-all duration-200 active:scale-95 ${
                        message.feedbackGiven === 'up'
                          ? 'text-green-600 bg-green-100 dark:bg-green-900/30 ring-2 ring-green-200 dark:ring-green-800'
                          : 'text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                      }`}
                      title="Helpful"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleFeedback(index, 'down')}
                      className={`p-1.5 rounded-lg transition-all duration-200 active:scale-95 ${
                        message.feedbackGiven === 'down'
                          ? 'text-red-600 bg-red-100 dark:bg-red-900/30 ring-2 ring-red-200 dark:ring-red-800'
                          : 'text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                      }`}
                      title="Not helpful"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="bg-white dark:bg-gray-800 border border-[var(--v2-border)] px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-[var(--v2-primary)] animate-spin" />
                    <span className="text-xs text-[var(--v2-text-muted)]">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          {/* Quick Questions */}
          {messages.length === 1 && !isLoading && !isInputHelp && (
            <div className="px-3 sm:px-4 py-3 border-t border-[var(--v2-border)] bg-gray-50/50 dark:bg-gray-900/20 backdrop-blur-sm">
              <div className="text-xs font-medium text-[var(--v2-text-muted)] mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Quick questions:
              </div>
              <div className="flex flex-wrap gap-2">
                {pageContext.helpTopics.slice(0, 2).map((topic, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuickQuestion(topic)}
                    className="text-xs px-3 py-1.5 bg-white dark:bg-gray-800 border border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-primary)]/5 active:scale-95 transition-all duration-200 font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Input Bar */}
          <div className="p-3 sm:p-4 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={isInputHelp ? 'Paste your link or info here...' : 'Ask me anything...'}
                className="flex-1 px-4 py-3 bg-white dark:bg-gray-800 border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:border-transparent transition-all duration-200"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-4 py-3 bg-gradient-to-br from-[var(--v2-primary)] to-purple-600 text-white hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200 flex items-center justify-center"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
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