'use client'

import React, { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { MessageCircle, X, Send, Loader2, ThumbsUp, ThumbsDown, BookOpen, Database, Zap, Sparkles, Bot, XCircle } from 'lucide-react'
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
  '/v2/dashboard': {
    title: 'Dashboard',
    description: 'Your command center for agents, credits, and system activity',
    helpTopics: [
      'How do I view my agent performance?',
      'What do Pilot Credits mean?',
      'How do I create a new agent?',
      'What are the different agent statuses?',
      'How do I check my remaining credits?'
    ]
  },
  '/v2/agent-list': {
    title: 'Agent List',
    description: 'Manage, filter, and monitor all your AI agents',
    helpTopics: [
      'How do I filter agents by status?',
      'What do agent statuses mean?',
      'How do I edit an agent?',
      'How do I delete an agent?',
      'What is the AIS score?'
    ]
  },
  '/v2/agents': {
    title: 'Agents',
    description: 'Browse and manage your AI automation agents',
    helpTopics: [
      'How do I create a new agent?',
      'What types of agents can I build?',
      'How do I view agent details?'
    ]
  },
  '/v2/agents/new': {
    title: 'Create Agent',
    description: 'Build a new AI agent using our conversational builder',
    helpTopics: [
      'How does the agent builder work?',
      'What information do I need to provide?',
      'How do I connect plugins?',
      'Can I test my agent before saving?',
      'What are input and output schemas?'
    ]
  },
  '/v2/analytics': {
    title: 'Analytics',
    description: 'Track performance metrics, costs, and usage patterns',
    helpTopics: [
      'How do I interpret the cost breakdown?',
      'What metrics are tracked?',
      'How do I export analytics data?',
      'What is token usage?',
      'How do I optimize costs?'
    ]
  },
  '/v2/billing': {
    title: 'Billing',
    description: 'Manage your subscription, credits, and payment methods',
    helpTopics: [
      'How do I add more Pilot Credits?',
      'What are Pilot Credits vs Raw Tokens?',
      'How is usage calculated?',
      'How do I upgrade my plan?',
      'What happens when I run out of credits?'
    ]
  },
  '/v2/settings': {
    title: 'Settings',
    description: 'Configure your account, API keys, and integrations',
    helpTopics: [
      'How do I add API keys?',
      'How do I manage plugin connections?',
      'How do I update my profile?',
      'How do I connect to Slack?',
      'What security settings are available?'
    ]
  },
  '/v2/templates': {
    title: 'Templates',
    description: 'Browse pre-built agent templates for common use cases',
    helpTopics: [
      'How do I use a template?',
      'Can I customize templates?',
      'What templates are available?'
    ]
  },
  '/v2/monitoring': {
    title: 'Monitoring',
    description: 'Real-time monitoring and logs for your agents',
    helpTopics: [
      'How do I view agent execution logs?',
      'What does the monitoring dashboard show?',
      'How do I troubleshoot failed executions?',
      'What are execution statuses?'
    ]
  },
  '/v2/notifications': {
    title: 'Notifications',
    description: 'Manage alerts and notifications for your agents',
    helpTopics: [
      'How do I set up notifications?',
      'What types of alerts are available?',
      'How do I configure Slack notifications?',
      'Can I customize notification preferences?'
    ]
  },
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
  const { isOpen: controlledOpen, context, onFill, onClose } = props

  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  // Internally controlled vs modal modes
  const [isOpenInternal, setIsOpenInternal] = useState(false)
  const isInputHelp = !!context && context.mode === 'input_help'
  const isOpen = controlledOpen !== undefined ? controlledOpen : isOpenInternal

  // Persist messages across page refreshes using sessionStorage
  // Initialize as empty - useEffect will load the correct messages
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Dynamic page context matching for parameterized routes
  const getPageContext = (path: string): PageContext => {
    // Try exact match first
    if (PAGE_CONTEXTS[path]) {
      return PAGE_CONTEXTS[path]
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
    console.log('[HelpBot Init Effect] TRIGGERED - isOpen:', isOpen, 'isInputHelp:', isInputHelp, 'context?.fieldName:', context?.fieldName || 'null', 'sessionInitialized:', sessionInitialized)
    console.log('[HelpBot Init Effect] Current messages count:', messages.length)
    console.log('[HelpBot Init Effect] Context object:', context)

    if (!isOpen) {
      // Only reset when explicitly closed, not on re-renders
      if (sessionInitialized) {
        console.log('[HelpBot Init Effect] Chatbot closed, resetting session')
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

    console.log('[HelpBot Init Effect] SESSION CHECK:')
    console.log('  - currentSessionId:', currentSessionId)
    console.log('  - sessionIdRef.current:', sessionIdRef.current)
    console.log('  - Are they equal?', sessionIdRef.current === currentSessionId)
    console.log('  - isInputHelp:', isInputHelp)
    console.log('  - context exists:', !!context)

    // Only initialize if this is a NEW session
    if (sessionIdRef.current === currentSessionId) {
      console.log('[HelpBot Init Effect] ❌ Same session, skipping initialization')
      return // Same session, don't reinitialize
    }

    console.log('[HelpBot Init Effect] ✅ NEW SESSION DETECTED! Switching conversations...')

    // New session - initialize
    // Update session ref IMMEDIATELY to prevent re-runs
    const previousSessionId = sessionIdRef.current
    sessionIdRef.current = currentSessionId
    setSessionInitialized(false) // Reset flag for new session

    console.log('[HelpBot Init Effect] New session! previous:', previousSessionId, 'current:', currentSessionId)

    if (isInputHelp && context) {
      // Input help mode - load field-specific conversation
      console.log('[HelpBot Init Effect] Loading input help for field:', context.fieldName)
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
          console.log('[HelpBot Init Effect] Loaded saved conversation:', savedMessages.length, 'messages')

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
          console.log('[HelpBot Init Effect] New field conversation, showing welcome')
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
      console.log('[HelpBot Init Effect] Loading general help mode')
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
    console.log('[HelpBot] Messages state updated:', messages.length, 'messages')
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ---- SEND HANDLER: PASSES SPECIAL CONTEXT IF PRESENT, DETECTS FILL ACTION ----
  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    // Store the original input for later
    const originalInput = input.trim()

    // Check if user typed a number to select a quick question (only if we have help topics)
    if (!isInputHelp && messages.length === 1 && pageContext.helpTopics.length > 0) {
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

  console.log('[HelpBot] Rendering with messages:', messages.length, 'messages for field:', context?.fieldName)
  messages.forEach((msg, idx) => {
    console.log(`  Message ${idx} (${msg.role}):`, msg.content.substring(0, 100))
  })

  return (
    <>
      {/* Floating Button - only show if not in input help mode (modal) */}
      {!isInputHelp && !isOpen && (
        <button
          onClick={() => setIsOpenInternal(true)}
          className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-[var(--v2-primary)] to-purple-600 text-white shadow-lg hover:shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center z-40 group"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
          title="Help & Support"
        >
          <Bot className="w-5 h-5 sm:w-6 sm:h-6 group-hover:rotate-12 transition-transform duration-300" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 animate-pulse"></div>
          <Sparkles className="absolute top-1 right-1 w-2.5 h-2.5 text-yellow-300 animate-pulse" />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-20 left-2 right-2 sm:bottom-28 sm:left-auto sm:right-6 sm:w-[440px] h-[calc(100vh-10rem)] sm:h-[calc(100vh-11rem)] max-h-[700px] sm:max-h-[600px] bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] z-50 flex flex-col border border-[var(--v2-border)] backdrop-blur-xl animate-in slide-in-from-bottom-4 duration-300 rounded-[16px] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--v2-border)]/50 bg-gradient-to-r from-[var(--v2-primary)] via-purple-600 to-[var(--v2-primary)] text-white backdrop-blur-xl rounded-t-[16px]">
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
            <button
              onClick={() => { if (onClose) onClose(); setIsOpenInternal(false); }}
              className="p-2 hover:bg-white/20 rounded-lg transition-all duration-200 active:scale-95 backdrop-blur-sm"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-4 bg-gradient-to-b from-gray-50/50 to-transparent dark:from-gray-900/20" onClick={handleMessageClick}>
            {messages.map((message, index) => (
              <div key={`${sessionIdRef.current}-${index}`} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                <div className={`max-w-[85%] sm:max-w-[80%] px-4 py-3 shadow-sm ${
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-[var(--v2-primary)] to-purple-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-[var(--v2-text-primary)] border border-[var(--v2-border)]'
                }`}
                  style={{
                    borderRadius: message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  }}>
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