'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { MessageCircle, X, Send, Loader2, ThumbsUp, ThumbsDown, BookOpen, Database, Zap, Sparkles, Bot, XCircle } from 'lucide-react'
import { useAuth } from '@/components/UserProvider'
import { requestDeduplicator } from '@/lib/utils/request-deduplication'

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

// Default fallback contexts (will be replaced by database contexts)
const DEFAULT_PAGE_CONTEXTS: Record<string, PageContext> = {
  '/v2/dashboard': {
    title: 'Dashboard',
    description: 'Your command center for agents, credits, and system activity',
    helpTopics: [
      'How do I view my agent performance?',
      'What do Pilot Credits mean?',
      'How do I create a new agent?'
    ]
  },
  '/v2/agent-list': {
    title: 'Agent List',
    description: 'Manage, filter, and monitor all your AI agents',
    helpTopics: [
      'How do I filter agents by status?',
      'What do agent statuses mean?',
      'What is the AIS score?'
    ]
  }
}

// ---- ADDED TYPES FOR FIELD-SPECIFIC HELP ----
interface InputHelpContext {
  mode: 'input_help'
  agentId: string
  fieldName: string
  fieldLabel?: string
  plugin?: string
  expectedType?: string
}
type HelpBotProps = {
  isOpen?: boolean
  context?: InputHelpContext
  onFill?: (value: string) => void
  onClose?: () => void
  onOpen?: () => void  // Called when user clicks the floating button (for controlled mode)
}
// ---------------------------------------------

function renderMarkdown(text: string) {
  let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-[var(--v2-text-primary)]">$1</strong>')

  // Convert markdown links first
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      if (url.startsWith('/')) return `<a class="text-[var(--v2-primary)] hover:underline font-medium cursor-pointer internal-link transition-colors" data-path="${url}">${linkText}</a>`
      else if (url.startsWith('http')) return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-[var(--v2-primary)] hover:underline font-medium transition-colors">${linkText}</a>`
      return match
    }
  )

  // Convert bare URLs to links, but only if they're not already inside an href or other HTML tag
  // Use negative lookbehind to avoid matching URLs inside href="..." or other attributes
  processed = processed.replace(
    /(?<!href="|src="|content=")(https?:\/\/[^\s<"']+)(?!")/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-[var(--v2-primary)] hover:underline">$1</a>'
  )

  // Convert line breaks to <br> tags (double line breaks to paragraphs, single to br)
  processed = processed.replace(/\n\n/g, '</p><p class="mt-3">')
  processed = processed.replace(/\n/g, '<br>')
  processed = `<p>${processed}</p>`

  return processed
}

// ---- MAIN COMPONENT ----
export function HelpBot(props: HelpBotProps) {
  const { isOpen: controlledOpen, context, onFill, onClose, onOpen } = props

  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  // Internally controlled vs modal modes
  const [isOpenInternal, setIsOpenInternal] = useState(false)
  const isInputHelp = !!context && context.mode === 'input_help'
  const isOpen = controlledOpen !== undefined ? controlledOpen : isOpenInternal

  // Load page contexts from database
  const [pageContexts, setPageContexts] = useState<Record<string, PageContext>>(DEFAULT_PAGE_CONTEXTS)
  const [contextsLoaded, setContextsLoaded] = useState(false)

  // Load HelpBot theme colors from database
  const [themeColors, setThemeColors] = useState<{
    primary: string
    secondary: string
    border: string
    shadow: string
    closeButton: string
  }>({
    primary: '#8b5cf6',  // Default purple
    secondary: '#9333ea', // Default darker purple for gradients
    border: '#e2e8f0',   // Default gray
    shadow: 'rgba(139, 92, 246, 0.2)',  // Default purple shadow
    closeButton: '#ef4444'  // Default red
  })
  const [themeLoaded, setThemeLoaded] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)

  // Persist messages across page refreshes using sessionStorage
  // Initialize as empty - useEffect will load the correct messages
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load page contexts and theme colors from API on mount
  useEffect(() => {
    async function loadPageContexts() {
      try {
        // Use request deduplication with 5 minute cache - config rarely changes
        const result = await requestDeduplicator.deduplicate(
          'helpbot-page-contexts',
          async () => {
            const response = await fetch('/api/helpbot/page-contexts')
            return response.json()
          },
          300000 // 5 minute cache TTL
        )

        if (result.success && result.contexts) {
          // Convert array to object keyed by page_route
          const contextsMap: Record<string, PageContext> = {}
          result.contexts.forEach((ctx: any) => {
            contextsMap[ctx.page_route] = {
              title: ctx.title,
              description: ctx.description || '',
              helpTopics: ctx.quick_questions || []
            }
          })
          setPageContexts({ ...DEFAULT_PAGE_CONTEXTS, ...contextsMap })
          setContextsLoaded(true)
        }
      } catch (error) {
        console.error('[HelpBot] Failed to load page contexts:', error)
        // Continue with default contexts
        setContextsLoaded(true)
      }
    }

    async function loadThemeColors() {
      try {
        // Use request deduplication with 5 minute cache - config rarely changes
        const result = await requestDeduplicator.deduplicate(
          'helpbot-theme-config',
          async () => {
            const response = await fetch('/api/admin/helpbot-config')
            return response.json()
          },
          300000 // 5 minute cache TTL
        )

        if (result.success && result.config?.theme) {
          const primaryColor = result.config.theme.primaryColor || '#8b5cf6'
          setThemeColors({
            primary: primaryColor,
            secondary: result.config.theme.secondaryColor || primaryColor, // Use primary if secondary not set
            border: result.config.theme.borderColor || '#e2e8f0',
            shadow: result.config.theme.shadowColor || 'rgba(139, 92, 246, 0.2)',
            closeButton: result.config.theme.closeButtonColor || '#ef4444'
          })
        }
      } catch (error) {
        console.error('[HelpBot] Failed to load theme colors:', error)
        // Continue with default colors
      } finally {
        setThemeLoaded(true)
      }
    }

    loadPageContexts()
    loadThemeColors()
    setIsMounted(true)
    setPortalTarget(document.body)
  }, [])

  // Dynamic page context matching for parameterized routes
  const getPageContext = (path: string): PageContext => {
    // Try exact match first
    if (pageContexts[path]) {
      return pageContexts[path]
    }

    // Check for dynamic routes
    if (path.match(/^\/v2\/agents\/[^/]+$/)) {
      // Agent detail page: /v2/agents/[id]
      return {
        title: 'Agent Details',
        description: 'View and manage a specific agent',
        helpTopics: [
          'How do I edit this agent?',
          'How do I run this agent?',
          'What is the AIS score?',
          'How do I view execution history?',
          'How do I delete this agent?',
          'What are connected plugins?'
        ]
      }
    }

    if (path.match(/^\/v2\/agents\/[^/]+\/run$/)) {
      // Agent run page: /v2/agents/[id]/run
      return {
        title: 'Run Agent',
        description: 'Execute your agent and view results',
        helpTopics: [
          'How do I provide input to my agent?',
          'What happens when I run an agent?',
          'How do I view execution results?',
          'What are execution logs?',
          'How much does it cost to run an agent?'
        ]
      }
    }

    if (path.match(/^\/v2\/sandbox\/[^/]+$/)) {
      // Sandbox/Debugger page: /v2/sandbox/[agentId]
      return {
        title: 'Agent Debugger',
        description: 'Step through agent execution and debug workflows',
        helpTopics: [
          'How do I use the debugger?',
          'What do the debug controls do?',
          'How do I step through execution?',
          'How do I inspect step data?',
          'What are Pilot Credits?',
          'How do I pause and resume execution?'
        ]
      }
    }

    // Default fallback
    return {
      title: 'NeuronForge',
      description: 'AI Agent Platform',
      helpTopics: [
        'How do I get started?',
        'What can I do here?',
        'How do I create my first agent?'
      ]
    }
  }

  const pageContext = getPageContext(pathname)

  // ---- MODAL/FIELD-HELP WELCOME & CONTEXT ----
  // Track if we've initialized this session to prevent resets
  // Use ref to persist across re-renders even when parent re-renders
  const sessionIdRef = useRef<string | null>(null)
  const [sessionInitialized, setSessionInitialized] = useState(false)

  // Save messages to sessionStorage when they change (input help mode only)
  useEffect(() => {
    if (typeof window !== 'undefined' && isInputHelp && context && messages.length > 0 && user?.id) {
      // Only save if the current session matches the context
      const currentSessionId = `input_help_${user.id}_${context.agentId}_${context.fieldName}`
      if (sessionIdRef.current === currentSessionId) {
        // Version 3: includes user ID to prevent cross-user contamination
        const STORAGE_VERSION = 'v3'
        const storageKey = `helpBot_messages_${STORAGE_VERSION}_${user.id}_${context.agentId}_${context.fieldName}`
        sessionStorage.setItem(storageKey, JSON.stringify(messages))
      }
    }
  }, [messages, isInputHelp, context?.agentId, context?.fieldName, user?.id])

  useEffect(() => {
    if (!isOpen) {
      // Only reset when explicitly closed, not on re-renders
      if (sessionInitialized) {
        setSessionInitialized(false)
        sessionIdRef.current = null
      }
      return
    }

    // Create unique session ID based on context, user, AND page
    // This ensures conversations reset when switching users OR pages
    const currentSessionId = isInputHelp && context
      ? `input_help_${user?.id || 'anonymous'}_${context.agentId}_${context.fieldName}`
      : `general_help_${user?.id || 'anonymous'}_${pathname}`

    // Only initialize if this is a NEW session
    if (sessionIdRef.current === currentSessionId) {
      return // Same session, don't reinitialize
    }

    // New session - initialize
    // Update session ref IMMEDIATELY to prevent re-runs
    const previousSessionId = sessionIdRef.current
    sessionIdRef.current = currentSessionId
    setSessionInitialized(false) // Reset flag for new session

    if (isInputHelp && context) {
      // Input help mode - load field-specific conversation
      if (typeof window !== 'undefined' && user?.id) {
        // Version 3: includes user ID to prevent cross-user contamination
        const STORAGE_VERSION = 'v3'
        const storageKey = `helpBot_messages_${STORAGE_VERSION}_${user.id}_${context.agentId}_${context.fieldName}`
        const saved = sessionStorage.getItem(storageKey)

        // Clean up old version storage keys (v1 and v2 without user ID)
        const oldStorageKeyV2 = `helpBot_messages_v2_${context.agentId}_${context.fieldName}`
        const oldStorageKeyV1 = `helpBot_messages_${context.agentId}_${context.fieldName}`
        if (sessionStorage.getItem(oldStorageKeyV2)) {
          sessionStorage.removeItem(oldStorageKeyV2)
        }
        if (sessionStorage.getItem(oldStorageKeyV1)) {
          sessionStorage.removeItem(oldStorageKeyV1)
        }

        if (saved) {
          // Load existing conversation for this field
          let savedMessages = JSON.parse(saved)

          const displayLabel = context.fieldLabel || context.fieldName

          // Clean up old format
          savedMessages = savedMessages.map((msg: Message, index: number) => {
            // Replace full URLs in user messages with placeholder
            if (msg.role === 'user' && msg.content.includes('http')) {
              if (!msg.content.includes('[Link provided]')) {
                return { ...msg, content: '🔗 [Link provided]' }
              }
            }

            if (msg.role === 'assistant') {
              // Update the first assistant message (welcome) if it uses old field name format
              if (index === 0 && msg.content.includes('field')) {
                // Check if it contains any underscore-based field name or old generic message
                const isOldMessage =
                  msg.content.match(/[a-z]+_[a-z]+/i) ||
                  msg.content.includes('send me the link or info') ||
                  msg.content.includes("I'm here to help you fill the") ||
                  msg.content.includes("extract only what's needed");

                if (isOldMessage) {
                  // Regenerate context-aware message
                  const fieldType = context.expectedType || 'string'
                  let welcomeMessage = ''

                  if (fieldType === 'email' || displayLabel.toLowerCase().includes('email')) {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Just paste an email address or any text containing an email, and I'll extract it for you!`
                  } else if (fieldType === 'url' || displayLabel.toLowerCase().includes('url') || displayLabel.toLowerCase().includes('link')) {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Share a URL or link, and I'll extract and validate it for you!`
                  } else if (displayLabel.toLowerCase().includes('spreadsheet') || displayLabel.toLowerCase().includes('sheet')) {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Paste a Google Sheets link or share URL, and I'll extract the spreadsheet ID!`
                  } else if (displayLabel.toLowerCase().includes('database') || displayLabel.toLowerCase().includes('db')) {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Share a database URL or connection string, and I'll extract the database ID or relevant info!`
                  } else if (fieldType === 'number' || displayLabel.toLowerCase().includes('number') || displayLabel.toLowerCase().includes('count')) {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Just tell me the number or share text containing it, and I'll extract the numeric value!`
                  } else if (fieldType === 'date') {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Share a date in any format, and I'll format it correctly for you!`
                  } else if (fieldType === 'boolean') {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Tell me yes/no, true/false, or describe what you want, and I'll set the right value!`
                  } else {
                    welcomeMessage = `I can help you with the **${displayLabel}** field. Share any relevant information, and I'll extract what's needed and fill it for you!`
                  }

                  return {
                    ...msg,
                    content: welcomeMessage
                  }
                }
              }

              // Update old success messages that don't show the extracted value
              if (msg.content.includes("I've filled") && msg.content.includes("with the extracted value")) {
                // This is an old success message - remove it so a new one will be shown
                // Mark for removal by returning null (we'll filter it out below)
                return null
              }
            }

            return msg
          }).filter(Boolean) as Message[]  // Remove null entries

          // Force a new array reference to ensure React detects the change
          setMessages([...savedMessages])
        } else {
          // New field - show welcome message
          const displayLabel = context.fieldLabel || context.fieldName
          const fieldType = context.expectedType || 'string'

          // Create context-aware welcome message based on field type
          let welcomeMessage = ''
          if (fieldType === 'email' || displayLabel.toLowerCase().includes('email')) {
            welcomeMessage = `I can help you with the **${displayLabel}** field. Just paste an email address or any text containing an email, and I'll extract it for you!`
          } else if (fieldType === 'url' || displayLabel.toLowerCase().includes('url') || displayLabel.toLowerCase().includes('link')) {
            welcomeMessage = `I can help you with the **${displayLabel}** field. Share a URL or link, and I'll extract and validate it for you!`
          } else if (displayLabel.toLowerCase().includes('spreadsheet') || displayLabel.toLowerCase().includes('sheet')) {
            welcomeMessage = `I can help you with the **${displayLabel}** field. Paste a Google Sheets link or share URL, and I'll extract the spreadsheet ID!`
          } else if (displayLabel.toLowerCase().includes('database') || displayLabel.toLowerCase().includes('db')) {
            welcomeMessage = `I can help you with the **${displayLabel}** field. Share a database URL or connection string, and I'll extract the database ID or relevant info!`
          } else if (fieldType === 'number' || displayLabel.toLowerCase().includes('number') || displayLabel.toLowerCase().includes('count')) {
            welcomeMessage = `I can help you with the **${displayLabel}** field. Just tell me the number or share text containing it, and I'll extract the numeric value!`
          } else if (fieldType === 'date') {
            welcomeMessage = `I can help you with the **${displayLabel}** field. Share a date in any format, and I'll format it correctly for you!`
          } else if (fieldType === 'boolean') {
            welcomeMessage = `I can help you with the **${displayLabel}** field. Tell me yes/no, true/false, or describe what you want, and I'll set the right value!`
          } else {
            // Generic fallback for string and other types
            welcomeMessage = `I can help you with the **${displayLabel}** field. Share any relevant information, and I'll extract what's needed and fill it for you!`
          }

          setMessages([
            {
              role: 'assistant',
              content: welcomeMessage,
            },
          ])
        }
      }
      setSessionInitialized(true)
    } else {
      // General help mode
      setMessages([
        {
          role: 'assistant',
          content: `Hi! I'm your **${pageContext.title}** assistant.

I can help you with:

${pageContext.helpTopics.map((topic, i) => `**${i + 1}.** ${topic}`).join('\n\n')}

What would you like to know?`,
        },
      ])
      setSessionInitialized(true)
    }
    // eslint-disable-next-line
  }, [isOpen, context?.agentId, context?.fieldName, user?.id, pathname])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ---- SEND HANDLER: PASSES SPECIAL CONTEXT IF PRESENT, DETECTS FILL ACTION ----
  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    // Store the original input for later
    const originalInput = input.trim()

    // Check if user typed a number to select a quick question (only if we have help topics)
    if (!isInputHelp && pageContext.helpTopics.length > 0) {
      const numberMatch = originalInput.match(/^(\d+)$/)
      if (numberMatch) {
        const selectedIndex = parseInt(numberMatch[1], 10) - 1
        if (selectedIndex >= 0 && selectedIndex < pageContext.helpTopics.length) {
          // User selected a quick question by number
          const selectedQuestion = pageContext.helpTopics[selectedIndex]
          setInput(selectedQuestion)
          // Let it fall through to send the question
          return handleQuickQuestion(selectedQuestion)
        }
      }
    }

    // Check if this is a URL being pasted for ID extraction
    const isUrl = /^https?:\/\/.+/.test(originalInput)
    const isIdField = context?.fieldName && /_id$|^id$/i.test(context.fieldName)

    // If it's a URL for an ID field, show placeholder immediately instead of the full URL
    const displayContent = (isInputHelp && isUrl && isIdField)
      ? '🔗 [Link provided]'
      : originalInput

    const userMessage: Message = { role: 'user', content: displayContent }
    const apiMessage: Message = { role: 'user', content: originalInput } // Always send original to API
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user?.id) headers['x-user-id'] = user.id
      const body = isInputHelp
        ? { messages: [...messages, apiMessage], context }
        : { messages: [...messages, apiMessage], pageContext: { ...pageContext, path: pathname } }
      const response = await fetch('/api/help-bot-v2', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error)

      // ---- SPECIAL FILL HANDLER ----
      let responseContent = data.response
      let actionHandled = false

      try {
        // Check if response contains JSON action (could be mixed with text)
        const jsonMatch = data.response.match(/\{[\s\S]*?"action"[\s\S]*?\}/)
        if (jsonMatch) {
          const maybeJSON = JSON.parse(jsonMatch[0])

          if (
            maybeJSON &&
            maybeJSON.action === 'fill_agent_input' &&
            maybeJSON.value &&
            typeof onFill === 'function' &&
            isInputHelp
          ) {
            // Fill the input
            onFill(maybeJSON.value)
            actionHandled = true

            // Extract the user-friendly message (text before the JSON)
            const textBeforeJSON = data.response.substring(0, jsonMatch.index).trim()

            // Add success message with the extracted value
            setMessages((prev) => {
              const lastMessage = prev[prev.length - 1]
              // If the last message already shows the placeholder, just add success message
              if (lastMessage.content === '🔗 [Link provided]') {
                return [
                  ...prev,
                  {
                    role: 'assistant',
                    content: textBeforeJSON || `✓ Extracted and filled: **${maybeJSON.value}**\n\nNeed help with anything else?`,
                  },
                ]
              }
              // Otherwise, replace the URL with placeholder and add success message
              return [
                ...prev.slice(0, -1),
                {
                  role: 'user',
                  content: '🔗 [Link provided]',
                },
                {
                  role: 'assistant',
                  content: textBeforeJSON || `✓ Extracted and filled: **${maybeJSON.value}**\n\nNeed help with anything else?`,
                },
              ]
            })
            setIsLoading(false)
            return // Skip adding the JSON response to messages
          }
        }

        // Fallback: If no JSON found but response indicates extraction, parse the value
        if (!actionHandled && isInputHelp && typeof onFill === 'function') {
          // Pattern to detect extracted values like "The X is: value" or "Extracted: value"
          const extractionPatterns = [
            /(?:is|are):\s*(.+?)(?:\n|$)/i,  // "The email is: value"
            /(?:extracted|found):\s*(.+?)(?:\n|$)/i,  // "Extracted: value"
            /(?:value|result):\s*(.+?)(?:\n|$)/i,  // "Value: xxx"
            /"([^"]+)"/,  // Quoted value
          ]

          for (const pattern of extractionPatterns) {
            const match = data.response.match(pattern)
            if (match && match[1]) {
              const extractedValue = match[1].trim()
              // Auto-fill the value
              onFill(extractedValue)
              actionHandled = true

              // Show success message
              setMessages((prev) => {
                const lastMessage = prev[prev.length - 1]
                if (lastMessage.content === '🔗 [Link provided]') {
                  return [
                    ...prev,
                    {
                      role: 'assistant',
                      content: `✓ Extracted and filled: **${extractedValue}**\n\nNeed help with anything else?`,
                    },
                  ]
                }
                return [
                  ...prev.slice(0, -1),
                  {
                    role: 'user',
                    content: '🔗 [Link provided]',
                  },
                  {
                    role: 'assistant',
                    content: `✓ Extracted and filled: **${extractedValue}**\n\nNeed help with anything else?`,
                  },
                ]
              })
              setIsLoading(false)
              return // Skip adding the response to messages
            }
          }
        }
      } catch (e) {
        console.error('[HelpBot] Error parsing fill action:', e)
      }

      // If no action was handled, show the regular response
      if (!actionHandled) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: responseContent,
            source: data.source,
            cacheId: data.cacheId,
            feedbackGiven: null,
          },
        ])
      }
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

  const handleQuickQuestion = (question: string) => {
    // Set the input to the full question and send it
    setInput(question)
    // Use setTimeout to ensure state updates before sending
    setTimeout(() => {
      // Manually trigger send with the question text
      handleSendWithText(question)
    }, 0)
  }

  // Helper to send a specific text (bypasses input field)
  const handleSendWithText = async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMessage: Message = { role: 'user', content: text }
    const apiMessage: Message = { role: 'user', content: text }

    setMessages((prev) => [...prev, userMessage])
    setInput('') // Clear input field
    setIsLoading(true)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user?.id) headers['x-user-id'] = user.id

      const body = isInputHelp
        ? { messages: [...messages, apiMessage], context }
        : { messages: [...messages, apiMessage], pageContext: { ...pageContext, path: pathname } }

      const response = await fetch('/api/help-bot-v2', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!response.ok) throw new Error('Failed to get response')

      const data = await response.json()

      // Note: Fill action handling is done in the main handleSend function

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
      console.error('[HelpBot] Error:', error)
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
      InputHelp: { icon: Zap, label: 'AI', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
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


  // Don't render until mounted on client and portal target is available
  if (!isMounted || !portalTarget) {
    return null
  }

  const content = (
    <>
      {/* Floating Button - stays visible on scroll (only show after theme loaded) */}
      {themeLoaded && !isInputHelp && !isOpen && (
        <button
          onClick={() => {
            // If controlled mode (parent passed isOpen), notify parent to open
            if (controlledOpen !== undefined && onOpen) {
              onOpen()
            } else {
              // Uncontrolled mode - manage internally
              setIsOpenInternal(true)
            }
          }}
          className="fixed bottom-6 right-6 w-12 h-12 sm:w-14 sm:h-14 text-white hover:shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center z-40 group"
          style={{
            borderRadius: 'var(--v2-radius-card)',
            background: `linear-gradient(to bottom right, ${themeColors.primary}, ${themeColors.secondary})`,
            boxShadow: themeColors.shadow
          }}
          title="Help & Support"
        >
          <Bot className="w-5 h-5 sm:w-6 sm:h-6 group-hover:rotate-12 transition-transform duration-300" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 animate-pulse"></div>
          <Sparkles className="absolute top-1 right-1 w-2.5 h-2.5 text-yellow-300 animate-pulse" />
        </button>
      )}

      {/* Chat Window - stays visible on scroll (only show after theme loaded) */}
      {themeLoaded && isOpen && (
        <div
          className="fixed bottom-20 left-2 right-2 sm:bottom-[88px] sm:left-auto sm:right-6 sm:w-[440px] h-[calc(100vh-10rem)] sm:h-[calc(100vh-11rem)] max-h-[700px] sm:max-h-[600px] bg-[var(--v2-surface)] z-50 flex flex-col backdrop-blur-xl animate-in slide-in-from-bottom-4 duration-300 rounded-[16px] overflow-hidden"
          style={{
            border: `1px solid ${themeColors.border}`,
            boxShadow: themeColors.shadow
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 sm:px-5 py-4 text-white backdrop-blur-xl rounded-t-[16px]"
            style={{
              background: `linear-gradient(to right, ${themeColors.primary}, ${themeColors.secondary}, ${themeColors.primary})`,
              borderBottom: `1px solid ${themeColors.border}50`
            }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ring-white/30 shadow-lg">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-white shadow-sm animate-pulse"></div>
              </div>
              <div>
                <div className="font-semibold text-sm sm:text-base tracking-tight">
                  {isInputHelp ? `Help With: ${context?.fieldLabel || context?.fieldName}` : `${pageContext.title} Assistant`}
                </div>
                <div className="text-xs opacity-90 flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="font-medium">Online now</span>
                </div>
              </div>
            </div>
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-4 bg-gradient-to-b from-gray-50/50 to-transparent dark:from-gray-900/20" onClick={handleMessageClick}>
            {messages.map((message, index) => (
              <div key={`${sessionIdRef.current}-${index}`} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                <div
                  className={`max-w-[85%] sm:max-w-[80%] px-4 py-3 shadow-sm ${
                    message.role === 'user'
                      ? 'text-white'
                      : 'bg-white dark:bg-gray-800 text-[var(--v2-text-primary)]'
                  }`}
                  style={{
                    borderRadius: message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    ...(message.role === 'user'
                      ? { background: `linear-gradient(to bottom right, ${themeColors.primary}, ${themeColors.secondary})` }
                      : { border: `1px solid ${themeColors.border}` })
                  }}
                >
                  <div
                    className={`text-sm leading-relaxed break-words overflow-hidden ${message.role === 'user' ? 'text-white' : ''}`}
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
                    className="text-xs px-3 py-1.5 bg-white dark:bg-gray-800 border active:scale-95 transition-all duration-200 font-medium text-[var(--v2-text-secondary)]"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      borderColor: themeColors.border
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = themeColors.primary
                      e.currentTarget.style.backgroundColor = `${themeColors.primary}0D` // 5% opacity
                      e.currentTarget.style.color = themeColors.primary
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = themeColors.border
                      e.currentTarget.style.backgroundColor = ''
                      e.currentTarget.style.color = ''
                    }}
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
                className="flex-1 px-4 py-3 bg-white dark:bg-gray-800 text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none transition-all duration-200"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  border: `1px solid ${themeColors.border}`
                }}
                onFocus={(e) => {
                  e.currentTarget.style.outline = 'none'
                  e.currentTarget.style.boxShadow = `0 0 0 2px ${themeColors.primary}40`
                  e.currentTarget.style.borderColor = themeColors.primary
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.borderColor = themeColors.border
                }}
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="px-4 py-3 text-white hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all duration-200 flex items-center justify-center"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  background: `linear-gradient(to bottom right, ${themeColors.primary}, ${themeColors.secondary})`
                }}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Button - stays visible on scroll (only show after theme loaded) */}
      {themeLoaded && isOpen && (
        <button
          onClick={() => { if (onClose) onClose(); setIsOpenInternal(false); }}
          className="fixed bottom-6 right-6 w-10 h-10 sm:w-12 sm:h-12 text-white hover:shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center z-[60] group"
          style={{
            borderRadius: 'var(--v2-radius-card)',
            backgroundColor: themeColors.closeButton,
            boxShadow: `0 4px 16px ${themeColors.closeButton}60`
          }}
          title="Close Help"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </button>
      )}
    </>
  )

  // Use portal to render outside the normal DOM hierarchy to avoid positioning issues
  return createPortal(content, portalTarget)
}