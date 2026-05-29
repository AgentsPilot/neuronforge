'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Search, X, MessageCircle, BookOpen, Zap, ArrowRight,
  Loader2, ThumbsUp, ThumbsDown, Sparkles, Command,
  ChevronRight, Hash, FileText, HelpCircle, ExternalLink
} from 'lucide-react'
import { useAuth } from '@/components/UserProvider'

interface Message {
  role: 'user' | 'assistant'
  content: string
  source?: 'FAQ' | 'Cache' | 'Groq' | 'AgentSearch'
  cacheId?: string
  feedbackGiven?: 'up' | 'down' | null
}

interface DocResult {
  id: string
  title: string
  snippet: string
  url: string
  relevanceScore: number
  category: string
}

interface HelpArticle {
  id: string
  title: string
  category: string
  description?: string
  path?: string
  keywords?: string[]
}

interface ModernHelpDialogProps {
  isOpen: boolean
  onClose: () => void
}

const PAGE_CONTEXTS: Record<string, { title: string; description: string; helpTopics: string[] }> = {
  '/v2/dashboard': {
    title: 'Dashboard',
    description: 'Overview of your agents, credits, and activity',
    helpTopics: ['How do I view my agent statistics?', 'What do the credit metrics mean?', 'How do I create a new agent?']
  },
  '/v2/agent-list': {
    title: 'Agent List',
    description: 'Manage and monitor all your agents',
    helpTopics: ['How do I filter agents?', 'What are agent statuses?', 'How do I edit an agent?']
  },
  '/v2/analytics': {
    title: 'Analytics',
    description: 'Track performance and costs',
    helpTopics: ['How do I interpret the cost breakdown?', 'What metrics are tracked?', 'How do I export analytics data?']
  },
  '/v2/billing': {
    title: 'Billing',
    description: 'Manage your subscription and credits',
    helpTopics: ['How do I add more credits?', 'What are Pilot Credits?', 'How is usage calculated?']
  },
  '/v2/settings': {
    title: 'Settings',
    description: 'Configure your account and preferences',
    helpTopics: ['How do I change my API keys?', 'How do I manage integrations?', 'How do I update my profile?']
  },
  '/v2/agents/new': {
    title: 'Create Agent',
    description: 'Build a new AI agent with conversational builder',
    helpTopics: ['How does the agent builder work?', 'What information do I need to provide?', 'Can I test my agent before saving?']
  },
}

const QUICK_ACTIONS = [
  { id: 'create-agent', title: 'Create New Agent', icon: Sparkles, path: '/v2/agents/new', category: 'Actions' },
  { id: 'view-agents', title: 'View All Agents', icon: FileText, path: '/v2/agent-list', category: 'Actions' },
  { id: 'billing', title: 'Manage Billing', icon: Hash, path: '/v2/billing', category: 'Actions' },
  { id: 'analytics', title: 'View Analytics', icon: Zap, path: '/v2/analytics', category: 'Actions' },
]

function renderMarkdown(text: string) {
  let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      if (url.startsWith('/'))
        return `<a class="text-[var(--v2-primary)] hover:underline font-medium cursor-pointer internal-link transition-colors" data-path="${url}">${linkText}</a>`
      else if (url.startsWith('http'))
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-[var(--v2-primary)] hover:underline font-medium transition-colors">${linkText}</a>`
      return match
    }
  )
  return processed
}

export function ModernHelpDialog({ isOpen, onClose }: ModernHelpDialogProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [mode, setMode] = useState<'search' | 'chat'>('search')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [relatedDocs, setRelatedDocs] = useState<DocResult[]>([])
  const [searchModeArticles, setSearchModeArticles] = useState<DocResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedArticle, setSelectedArticle] = useState<DocResult | null>(null)
  const [articleBody, setArticleBody] = useState<string>('')
  const [loadingArticle, setLoadingArticle] = useState(false)

  const pageContext = PAGE_CONTEXTS[pathname] || {
    title: 'NeuronForge',
    description: 'AI Agent Platform',
    helpTopics: ['How do I get started?', 'What can I do here?'],
  }

  // Convert help topics to articles format
  const helpArticles: HelpArticle[] = pageContext.helpTopics.map((topic, idx) => ({
    id: `topic-${idx}`,
    title: topic,
    category: 'FAQs',
    description: `Get help with: ${topic}`,
  }))

  // Convert search mode articles to HelpArticle format
  const searchArticles: HelpArticle[] = searchModeArticles.map((doc) => ({
    id: doc.id,
    title: doc.title,
    category: doc.category || 'Documentation',
    description: doc.snippet,
    path: doc.url,
  }))

  // Combine quick actions, help articles, and search results
  const allItems = [...QUICK_ACTIONS, ...helpArticles, ...searchArticles]

  // Filter items based on search query
  // IMPORTANT: Don't filter searchArticles - they're already filtered by the API
  const filteredItems = searchQuery.trim()
    ? [
        ...QUICK_ACTIONS.filter(item =>
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.category.toLowerCase().includes(searchQuery.toLowerCase())
        ),
        ...helpArticles.filter(item =>
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.category.toLowerCase().includes(searchQuery.toLowerCase())
        ),
        ...searchArticles  // Don't filter - already filtered and ranked by API
      ]
    : allItems

  // Group items by category
  const groupedItems = filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {} as Record<string, typeof allItems>)

  // Initialize chat mode with welcome message
  useEffect(() => {
    if (mode === 'chat' && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm your **${pageContext.title}** assistant. I can help you with:\n\n${pageContext.helpTopics.map((topic, i) => `${i + 1}. ${topic}`).join('\n')}\n\nWhat would you like to know?`,
      }])
    }
  }, [mode, messages.length, pageContext])

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setSearchQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Search for help articles in database (search mode)
  const fetchHelpArticles = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSearchModeArticles([])
      return
    }

    setIsSearching(true)
    try {
      const response = await fetch(
        `/api/help-bot-v2/search?q=${encodeURIComponent(query)}&context=${encodeURIComponent(pathname)}`
      )
      const data = await response.json()
      setSearchModeArticles(data.results || [])
    } catch (error) {
      console.error('Failed to search articles:', error)
      setSearchModeArticles([])
    } finally {
      setIsSearching(false)
    }
  }, [pathname])

  // Debounced search effect
  useEffect(() => {
    if (mode !== 'search') return

    const timer = setTimeout(() => {
      fetchHelpArticles(searchQuery)
    }, 300) // 300ms debounce

    return () => clearTimeout(timer)
  }, [searchQuery, mode, fetchHelpArticles])

  // Fetch full article body when article is selected
  useEffect(() => {
    if (!selectedArticle) {
      setArticleBody('')
      return
    }

    const fetchArticleBody = async () => {
      setLoadingArticle(true)
      try {
        const response = await fetch(`/api/help-bot-v2/article/${selectedArticle.id}`)
        const data = await response.json()
        setArticleBody(data.body || selectedArticle.snippet)
      } catch (error) {
        console.error('Failed to fetch article body:', error)
        setArticleBody(selectedArticle.snippet)
      } finally {
        setLoadingArticle(false)
      }
    }

    fetchArticleBody()
  }, [selectedArticle])

  // Handle send message - defined before handleItemClick which uses it
  const handleSendMessage = async (messageText?: string) => {
    const text = messageText || searchQuery
    if (!text.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])
    setSearchQuery('')
    setIsLoading(true)
    // Clear previous related docs when asking new question
    setRelatedDocs([])

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user?.id) headers['x-user-id'] = user.id

      const response = await fetch('/api/help-bot-v2', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [...messages, userMessage],
          pageContext: { ...pageContext, path: pathname }
        }),
      })

      const data = await response.json()
      if (data.error) throw new Error(data.error)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        source: data.source,
        cacheId: data.cacheId,
        feedbackGiven: null,
      }])

      // Store related docs if available
      if (data.relatedDocs && data.relatedDocs.length > 0) {
        setRelatedDocs(data.relatedDocs)
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again or contact support.",
      }])
    } finally {
      setIsLoading(false)
    }
  }

  // Handle item click - defined after handleSendMessage which it uses
  const handleItemClick = useCallback((item: typeof allItems[0]) => {
    if ('path' in item && item.path) {
      // Show article in modal for help documentation
      // Find the original DocResult from searchModeArticles
      const docResult = searchModeArticles.find(doc => doc.id === item.id)
      if (docResult) {
        setSelectedArticle(docResult)
        return
      }

      // If not a help article (like QUICK_ACTIONS), handle navigation
      // Check if it's an external URL
      if (item.path.startsWith('http://') || item.path.startsWith('https://')) {
        window.open(item.path, '_blank', 'noopener,noreferrer')
        // Don't close dialog, let user continue searching
      } else if (item.path !== '#') {
        // Internal path - navigate and close (only for quick actions, not help articles)
        router.push(item.path)
        onClose()
      }
    } else {
      // Switch to chat mode and ask the question
      setMode('chat')
      setSearchQuery(item.title)
      handleSendMessage(item.title)
    }
  }, [router, onClose, searchModeArticles, handleSendMessage, setMode, setSearchQuery])

  // Keyboard navigation - must be after handleItemClick definition
  useEffect(() => {
    if (!isOpen || mode === 'chat') return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Close article modal with ESC
      if (e.key === 'Escape' && selectedArticle) {
        e.preventDefault()
        setSelectedArticle(null)
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
        e.preventDefault()
        handleItemClick(filteredItems[selectedIndex])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, mode, filteredItems, selectedIndex, selectedArticle, handleItemClick])

  const handleFeedback = async (messageIndex: number, feedbackType: 'up' | 'down') => {
    const message = messages[messageIndex]
    if (!message.cacheId || message.feedbackGiven === feedbackType) return

    try {
      await fetch('/api/help-bot-v2/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheId: message.cacheId, feedbackType }),
      })
      setMessages(prev =>
        prev.map((msg, idx) => (idx === messageIndex ? { ...msg, feedbackGiven: feedbackType } : msg))
      )
    } catch (error) {
      // Silent fail
    }
  }

  const getSourceBadge = (source?: string) => {
    if (!source) return null
    const badges = {
      FAQ: { icon: BookOpen, label: 'FAQ', className: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30' },
      Cache: { icon: BookOpen, label: 'Cache', className: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30' },
      Groq: { icon: Sparkles, label: 'AI', className: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30' },
      AgentSearch: { icon: Search, label: 'Search', className: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30' },
    }
    const badge = badges[source as keyof typeof badges]
    if (!badge) return null
    const Icon = badge.icon
    return (
      <div className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${badge.className} font-medium`}>
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
        onClose()
      }
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 pointer-events-none">
        <div
          className="w-full max-w-2xl bg-[var(--v2-surface)] shadow-2xl border border-[var(--v2-border)] pointer-events-auto animate-in zoom-in-95 slide-in-from-top-4 duration-200"
          style={{ borderRadius: 'var(--v2-radius-card)', maxHeight: '80vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--v2-border)]">
            {mode === 'search' ? (
              <Search className="w-5 h-5 text-[var(--v2-text-muted)] flex-shrink-0" />
            ) : (
              <MessageCircle className="w-5 h-5 text-[var(--v2-primary)] flex-shrink-0" />
            )}

            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (mode === 'chat' && e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
              placeholder={mode === 'search' ? 'Search for help, actions, or FAQs...' : 'Ask me anything...'}
              className="flex-1 bg-transparent border-none outline-none text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] text-base"
            />

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Loading indicator for search mode */}
              {mode === 'search' && isSearching && (
                <Loader2 className="w-4 h-4 text-[var(--v2-primary)] animate-spin" />
              )}

              {/* Mode Toggle */}
              <button
                onClick={() => setMode(mode === 'search' ? 'chat' : 'search')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--v2-surface-hover)] hover:bg-[var(--v2-primary)]/10 text-[var(--v2-text-secondary)] hover:text-[var(--v2-primary)] transition-all duration-200 flex items-center gap-1.5"
                title={mode === 'search' ? 'Switch to AI Chat' : 'Switch to Search'}
              >
                {mode === 'search' ? (
                  <>
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>AI Chat</span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5" />
                    <span>Search</span>
                  </>
                )}
              </button>

              {/* Close Button */}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-[var(--v2-surface-hover)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 60px)' }}>
            {mode === 'search' ? (
              /* Search Mode */
              <div className="p-2">
                {Object.keys(groupedItems).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    {isSearching ? (
                      <>
                        <Loader2 className="w-12 h-12 text-[var(--v2-primary)] mb-3 animate-spin" />
                        <p className="text-sm text-[var(--v2-text-muted)]">Searching documentation...</p>
                      </>
                    ) : searchQuery.trim().length > 0 ? (
                      <>
                        <HelpCircle className="w-12 h-12 text-[var(--v2-text-muted)] mb-3" />
                        <p className="text-sm text-[var(--v2-text-muted)]">No results found for "{searchQuery}"</p>
                        <p className="text-xs text-[var(--v2-text-muted)] mt-2">Try different keywords or use AI Chat</p>
                        <button
                          onClick={() => {
                            setMode('chat')
                            if (searchQuery) handleSendMessage()
                          }}
                          className="mt-4 px-4 py-2 text-sm font-medium text-[var(--v2-primary)] hover:bg-[var(--v2-primary)]/10 rounded-lg transition-colors"
                        >
                          Ask AI Assistant instead
                        </button>
                      </>
                    ) : (
                      <>
                        <Search className="w-12 h-12 text-[var(--v2-text-muted)] mb-3" />
                        <p className="text-sm text-[var(--v2-text-primary)] font-medium">Search for help</p>
                        <p className="text-xs text-[var(--v2-text-muted)] mt-2">Type to search documentation, actions, and FAQs</p>
                      </>
                    )}
                  </div>
                ) : (
                  Object.entries(groupedItems).map(([category, items]) => (
                    <div key={category} className="mb-4">
                      <div className="px-3 py-2 text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                        {category}
                      </div>
                      <div className="space-y-1">
                        {items.map((item, idx) => {
                          const globalIndex = filteredItems.indexOf(item)
                          const isSelected = globalIndex === selectedIndex
                          const Icon = 'icon' in item ? item.icon : HelpCircle

                          return (
                            <button
                              key={item.id}
                              onClick={() => handleItemClick(item)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${
                                isSelected
                                  ? 'bg-[var(--v2-primary)]/10 text-[var(--v2-primary)]'
                                  : 'hover:bg-[var(--v2-surface-hover)] text-[var(--v2-text-primary)]'
                              }`}
                            >
                              <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-[var(--v2-primary)]' : 'text-[var(--v2-text-muted)]'}`} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{item.title}</div>
                                {item.description && (
                                  <div className="text-xs text-[var(--v2-text-muted)] truncate mt-0.5">
                                    {item.description}
                                  </div>
                                )}
                              </div>
                              {isSelected && (
                                <ChevronRight className="w-4 h-4 flex-shrink-0 text-[var(--v2-primary)]" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Chat Mode */
              <div className="p-4 space-y-4" onClick={handleMessageClick}>
                {/* Related Documentation Section */}
                {relatedDocs.length > 0 && (
                  <div className="mb-3 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="text-xs font-semibold text-[var(--v2-text-primary)] flex items-center gap-2 px-1">
                      <BookOpen className="w-4 h-4 text-[var(--v2-primary)]" />
                      Related Documentation
                    </div>
                    {relatedDocs.map((doc, index) => (
                      <a
                        key={doc.id}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 p-3 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-surface-hover)] transition-all duration-200 animate-in fade-in slide-in-from-left-2"
                        style={{ animationDelay: `${index * 80}ms` }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                              {doc.title}
                            </div>
                            {doc.category && doc.category !== 'general' && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] flex-shrink-0">
                                {doc.category}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--v2-text-muted)] line-clamp-2">
                            {doc.snippet}
                          </div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-[var(--v2-text-muted)] flex-shrink-0 mt-0.5" />
                      </a>
                    ))}
                  </div>
                )}

                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-200`}
                  >
                    <div
                      className={`max-w-[85%] px-4 py-3 rounded-2xl ${
                        message.role === 'user'
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'bg-[var(--v2-surface-hover)] text-[var(--v2-text-primary)] border border-[var(--v2-border)]'
                      }`}
                    >
                      <div
                        className="text-sm leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: message.role === 'assistant' ? renderMarkdown(message.content) : message.content
                        }}
                      />
                      {message.role === 'assistant' && message.source && (
                        <div className="mt-2">{getSourceBadge(message.source)}</div>
                      )}
                    </div>

                    {message.role === 'assistant' && message.cacheId && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          onClick={() => handleFeedback(index, 'up')}
                          className={`p-1.5 rounded-lg transition-all ${
                            message.feedbackGiven === 'up'
                              ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
                              : 'text-[var(--v2-text-muted)] hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleFeedback(index, 'down')}
                          className={`p-1.5 rounded-lg transition-all ${
                            message.feedbackGiven === 'down'
                              ? 'text-red-600 bg-red-100 dark:bg-red-900/30'
                              : 'text-[var(--v2-text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                          }`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] px-4 py-3 rounded-2xl">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 text-[var(--v2-primary)] animate-spin" />
                        <span className="text-xs text-[var(--v2-text-muted)]">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Footer Hint */}
          <div className="px-4 py-2 border-t border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <div className="flex items-center justify-between text-xs text-[var(--v2-text-muted)]">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[10px] font-mono">↑↓</kbd>
                  <span>Navigate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[10px] font-mono">↵</kbd>
                  <span>Select</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="px-1.5 py-0.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[10px] font-mono">esc</kbd>
                  <span>Close</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Powered by AI</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Article Detail Modal */}
      {selectedArticle && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedArticle(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] mx-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between p-6 border-b border-[var(--v2-border)]">
              <div className="flex-1 min-w-0 pr-4">
                <h2 className="text-xl font-semibold text-[var(--v2-text-primary)] mb-2">
                  {selectedArticle.title}
                </h2>
                {selectedArticle.category && selectedArticle.category !== 'general' && (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-[var(--v2-primary)]/10 text-[var(--v2-primary)]">
                    {selectedArticle.category}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedArticle(null)}
                className="flex-shrink-0 p-2 hover:bg-[var(--v2-surface-hover)] rounded-lg transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5 text-[var(--v2-text-muted)]" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6" onClick={handleMessageClick}>
              {loadingArticle ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-[var(--v2-primary)] animate-spin" />
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <div
                    className="text-[var(--v2-text-secondary)] leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(articleBody)
                    }}
                  />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--v2-text-muted)]">
                  Press <kbd className="px-1.5 py-0.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded text-[10px] font-mono">esc</kbd> to close
                </span>
                <button
                  onClick={() => setSelectedArticle(null)}
                  className="px-4 py-2 text-sm font-medium text-white bg-[var(--v2-primary)] hover:opacity-90 rounded-lg transition-all"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
