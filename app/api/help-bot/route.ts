// app/api/help-bot/route.ts
// API endpoint for help bot powered by Groq AI for intelligent, contextual responses

import { NextRequest, NextResponse } from 'next/server'
import { GroqProvider } from '@/lib/ai/providers/groqProvider'
import { createClient } from '@supabase/supabase-js'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const aiAnalytics = new AIAnalyticsService(supabase)

// Predefined Q&A database - no AI needed, zero cost
// Each entry can have multiple keywords (separated by |)
const QA_DATABASE: Record<string, Record<string, string>> = {
  '/v2/dashboard': {
    'three agents|only three|top 3|top three|limited agents|show more agents|all agents|why only|see all|showing few': 'The **Active Agents** card shows only the **top 3 most active agents** to save space. Click the card or "+X more" text to view all agents. To see your complete agent list, visit the [Agent List](/v2/agent-list) page.',
    'agent statistics|view agents|agent count|execution count|runs|executions|agent list|list agents': 'The **Active Agents** card shows your running agents with execution counts. Each agent displays its total number of runs. For a detailed view of all agents, go to the [Agent List](/v2/agent-list) page.',
    'credit metrics|credits|pilot credits|balance|tokens|how many|gauge|percentage|usage|remaining': '**Pilot Credits** are your usage currency. The circular gauge shows: **Left** = available credits, **Right** = used credits, **Percentage** = usage. 1 credit = 10 tokens by default. Click the gauge or visit [Billing](/v2/billing) to manage your credits.',
    'create agent|new agent|add agent|make agent|build agent|start|setup agent|configure agent': 'There are 2 ways to create agents:\n1. Click the **+ button** in the bottom-right footer\n2. Use the **search bar** at the top - describe what you want to automate\n\nYou can also go directly to [Create Agent](/agents/new).',
    'system alerts|failures|errors|problems|issues|failed|alerts card|error card': 'The **System Alerts** card shows agent failures in the last 24 hours:\n- **Green** (0) = All systems operational ✓\n- **Red** (>0) = Issues detected\nClick the card or visit [Analytics](/v2/analytics) to view detailed error logs.',
    'recent activity|activity|top agents|most active|progress bars|activity card|running agents': 'The **Recent Activity** card displays your top 3 most active agents with progress bars. Bar length shows relative execution count. This helps identify which agents are running most frequently.',
    'last run|when run|execution time|last execution|recent run|last execution time': 'The **Last Run** time in the footer shows when your most recent agent completed. Times are displayed as relative (e.g., "2h ago", "5m ago", "just now"). Updates automatically after each execution.',
    'cards|sections|navigate|overview|dashboard layout|dashboard structure': 'The dashboard has 4 main cards:\n1. **Active Agents** - View running agents ([Agent List](/v2/agent-list))\n2. **System Alerts** - Monitor failures ([Analytics](/v2/analytics))\n3. **Recent Activity** - Top 3 agents by execution\n4. **Credit Usage** - Track spending ([Billing](/v2/billing))',
    'search|find|look for|locate|where is|where can|navigation|go to': 'You can navigate to different sections:\n- [Agent List](/v2/agent-list): View all agents\n- [Analytics](/v2/analytics): Performance metrics\n- [Billing](/v2/billing): Manage credits\n- [Create Agent](/agents/new): Build new agent\n- [Settings](/v2/settings): Configure account',
    'footer|bottom|buttons|menu|three dots|3 dots|dots menu': 'The **footer** at the bottom has several features:\n- **Last Run**: Shows when your most recent agent executed\n- **Connected Plugins**: Displays active integrations with colorful icons\n- **Dark Mode**: Toggle light/dark theme\n- **+ Button**: Create a new agent\n- **3-dot Menu**: Quick access to Agent List, Dashboard, and Create Agent',
    'plugins|integrations|connected|connections|gmail|slack|github': 'The footer displays your **connected plugins** as colorful icons (Gmail, Slack, GitHub, etc.). These show which integrations are actively connected. A green dot indicates the plugin is active. Hover over an icon to see the plugin name.',
    'default': 'The dashboard provides an overview of your agents, credits, and activity. Use the cards to navigate to specific sections.',
  },
  '/v2/agent-list': {
    'filter|filtering|status filter|tabs|show|display|view by status': 'Use the tabs at the top to filter by status: **All**, **Active**, **Paused**, or **Stopped**. You can also search by name using the search bar.',
    'status|statuses|active|paused|stopped|agent status|status badge': '**Active** = running, **Paused** = temporarily stopped, **Stopped** = disabled. Toggle status by clicking the status badge in each agent card.',
    'edit|modify|change agent|update agent|configure|settings': 'Click any agent card to view details, then use the **Edit** button. You can modify configuration, schedule, and settings.',
    'delete|remove agent|remove|delete agent|uninstall': 'Open the agent details page, click the **Actions** menu (three dots), and select **Delete**. This action cannot be undone.',
    'search|find agent|locate agent|search bar|find by name': 'Use the search bar at the top to find agents by name. Results update as you type.',
    'sort|sorting|order|arrange|organize': 'Click the sort dropdown to order agents by: **Newest first**, **Oldest first**, **Name A-Z**, or **Name Z-A**.',
    'pagination|pages|next page|previous page|page navigation': 'Use the pagination controls at the bottom to navigate between pages. Shows 12 agents per page by default.',
    'all agents|view all|see all agents|complete list|full list': 'You are on the **Agent List** page which shows all your agents. Use the status tabs to filter, or the search bar to find specific agents.',
    'agent card|agent details|agent info|what shows|card layout': 'Each agent card displays: **Name**, **Status badge**, **Last run time**, **Execution count**, and a quick preview of the agent\'s purpose. Click any card to view full details.',
    'default': 'The agent list shows all your agents with filters and search. Click any agent to view or edit details.',
  },
  '/v2/analytics': {
    'cost|costs|spending|expensive|price|money|how much|cost breakdown': 'The [Analytics](/v2/analytics) dashboard tracks **token usage** and **costs** by agent. View trends over time and identify high-cost agents. Filter by date range to analyze spending patterns.',
    'metrics|tracking|tracked|monitor|data|statistics|stats': 'We track: **API calls**, **token usage** (input/output), **cost per agent**, **success rate**, and **latency**. All metrics update in real-time on the [Analytics](/v2/analytics) page.',
    'export|download|csv|json|save data|download data|export data': 'Click the **Export** button (top right) on the [Analytics](/v2/analytics) page to download analytics as CSV or JSON. Choose date range and metrics to export.',
    'tokens|token usage|input|output|token count|usage data': 'Token usage shows both **input tokens** (prompt) and **output tokens** (response). Total cost = (input tokens × input rate) + (output tokens × output rate). View detailed breakdowns in [Analytics](/v2/analytics).',
    'chart|graph|visualization|graphs|charts|trends|visualize': 'The [Analytics](/v2/analytics) page includes charts for cost trends, usage over time, and agent performance comparisons. Hover over data points for details.',
    'date range|filter date|time period|date filter|custom range': 'Use the date range picker on [Analytics](/v2/analytics) to filter by specific time periods. Choose from preset ranges (Last 7 days, Last 30 days) or select custom dates.',
    'agent performance|compare agents|which agent|best agent|worst agent': 'The [Analytics](/v2/analytics) dashboard lets you compare agent performance side-by-side. View execution counts, success rates, average latency, and total costs per agent.',
    'success rate|failures|error rate|failed executions': 'The **success rate** metric shows what percentage of agent executions completed successfully. Low success rates may indicate configuration issues. Check [Analytics](/v2/analytics) for details.',
    'default': 'The [Analytics](/v2/analytics) page provides insights into agent performance, costs, and usage patterns. Use filters to drill down by date or agent.',
  },
  '/v2/billing': {
    'add|buy|purchase credits|get more credits|top up|recharge': 'Visit [Billing](/v2/billing) and click **Add Credits** to purchase more. Credits are added instantly to your balance. We accept all major payment methods.',
    'pilot credits|what are credits|credit system|how credits work': '**Pilot Credits** are our token-based currency. 1 credit = 10 tokens (configurable). Credits never expire and roll over. Manage them on the [Billing](/v2/billing) page.',
    'usage|how calculated|pricing|cost calculation|billing calculation': 'Usage is based on **input + output tokens** consumed by your agents. Pricing varies by AI model used (OpenAI, Anthropic, Kimi). View details in [Billing](/v2/billing).',
    'invoice|receipt|payment history|transactions|past payments|billing history': 'View all past invoices and payment history in the **Transactions** tab on the [Billing](/v2/billing) page. Download receipts as PDF for accounting.',
    'subscription|plan|tier|upgrade|downgrade|change plan': 'Visit [Billing](/v2/billing) to manage your subscription tier and see plan limits. Upgrade or downgrade anytime - changes take effect immediately.',
    'payment method|card|billing info|update card|change payment|credit card': 'Update your payment method in **Payment Methods** on the [Billing](/v2/billing) page. We securely store card details and never share them.',
    'refund|cancel|charge|disputed|billing issue': 'For billing issues, refunds, or disputed charges, please contact support or email billing@neuronforge.com. You can also check your transaction history on the [Billing](/v2/billing) page.',
    'low balance|running out|need more|balance low': 'When your credit balance is low, you\'ll receive notifications. Visit [Billing](/v2/billing) and click **Add Credits** to purchase more instantly. Set up auto-recharge to never run out.',
    'default': 'The [Billing](/v2/billing) page shows your subscription status, credit balance, and usage history. Manage payment methods and view invoices here.',
  },
  '/v2/settings': {
    'api key|openai|anthropic|kimi|add key|update key|api keys|llm keys': 'Go to [Settings](/v2/settings) → **API Keys** to add or update keys for OpenAI, Anthropic, and Kimi. Keys are encrypted and secure.',
    'integration|connect|gmail|slack|github|integrations|plugins|connect service': 'Visit [Settings](/v2/settings) → **Integrations** to connect services like Gmail, Slack, GitHub. Click **Connect** next to each service.',
    'profile|name|email|password|account info|personal info|update profile': 'Go to [Settings](/v2/settings) → **Profile** to update your name, email, and password. Changes are saved automatically.',
    'notification|alerts|email preferences|notifications|email alerts|turn off': 'Configure notification preferences in [Settings](/v2/settings) → **Notifications**. Choose which alerts you want to receive via email.',
    'security|two factor|2fa|authentication|secure account|password security': 'Enable two-factor authentication in [Settings](/v2/settings) → **Security** for enhanced account protection.',
    'theme|dark mode|light mode|appearance|color scheme': 'Toggle between light and dark mode using the **Dark Mode** button in the footer, or set your preference in [Settings](/v2/settings) → **Appearance**.',
    'language|timezone|region|locale|time format': 'Configure your language, timezone, and regional settings in [Settings](/v2/settings) → **Preferences**. This affects date/time display and localization.',
    'default': 'The [Settings](/v2/settings) page lets you configure your account, API keys, integrations, and preferences. Changes are saved automatically.',
  },
}

// Enhanced keyword matching with word boundary detection and fuzzy matching
function findBestMatch(query: string, pageContext: string): string {
  const lowerQuery = query.toLowerCase().trim()
  const pageQA = QA_DATABASE[pageContext] || {}

  let bestMatch: string | null = null
  let bestScore = 0

  // Extract important words from query (remove common words)
  const commonWords = ['how', 'what', 'why', 'where', 'when', 'can', 'do', 'does', 'is', 'are', 'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'with', 'i', 'my', 'me', 'get', 'see', 'show']
  const queryWords = lowerQuery.split(/\s+/).filter(word => !commonWords.includes(word) && word.length > 2)

  // Try keyword matching with enhanced scoring
  for (const [keywords, answer] of Object.entries(pageQA)) {
    if (keywords === 'default') continue

    // Split pipe-separated keywords
    const keywordList = keywords.split('|').map(k => k.trim())

    let score = 0
    let exactMatches = 0

    for (const keyword of keywordList) {
      const keywordLower = keyword.toLowerCase()

      // Check if keyword is in query (exact phrase match)
      if (lowerQuery.includes(keywordLower)) {
        // Exact phrase match gets highest score
        const matchBonus = keyword.length * 5
        score += matchBonus
        exactMatches++
      } else {
        // Check word-by-word match for partial matches
        const keywordWords = keywordLower.split(/\s+/)
        let wordMatches = 0
        let totalKeywordWords = keywordWords.length

        for (const kw of keywordWords) {
          // Exact word match
          if (queryWords.includes(kw)) {
            wordMatches++
          } else {
            // Fuzzy match: check if query word starts with or contains keyword word
            for (const qw of queryWords) {
              if (qw.startsWith(kw) || kw.startsWith(qw)) {
                wordMatches += 0.7 // Partial credit for fuzzy match
                break
              }
            }
          }
        }

        // Calculate match percentage and score accordingly
        if (wordMatches > 0) {
          const matchPercentage = wordMatches / totalKeywordWords
          score += matchPercentage * keyword.length * 2
        }
      }
    }

    // Bonus for multiple exact matches
    if (exactMatches > 1) {
      score += exactMatches * 10
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = answer
    }
  }

  // Lower threshold for better coverage (was 3, now 2)
  if (bestMatch && bestScore > 2) {
    return bestMatch
  }

  // If no good match, provide helpful suggestions based on popular topics
  const suggestions = Object.keys(pageQA)
    .filter(k => k !== 'default')
    .slice(0, 4)
    .map(k => k.split('|')[0])
    .join('", "')

  return pageQA.default + `\n\n**Popular topics**: "${suggestions}"`
}

// Build system prompt with page context
function buildSystemPrompt(pageContext: any): string {
  const pagePath = pageContext.path || '/v2/dashboard'
  const pageTitle = pageContext.title || 'NeuronForge'
  const pageDescription = pageContext.description || 'AI Agent Platform'

  return `You are a helpful assistant for NeuronForge, an AI Agent Platform. You are currently helping users on the **${pageTitle}** page.

Page Description: ${pageDescription}
Current Path: ${pagePath}

Your role:
- Provide clear, concise answers about the current page and NeuronForge features
- Be friendly and conversational
- Use **bold** for emphasis on important terms
- Keep responses under 150 words
- If you mention UI elements, describe where they are located
- For navigation questions, provide step-by-step instructions
- **IMPORTANT**: When users ask about specific pages or features, include clickable navigation links using this format: [Link Text](/path)

Available pages (use these exact paths for links):
- Dashboard (/v2/dashboard): Overview of agents, credits, system alerts, and activity
- Agent List (/v2/agent-list): View, filter, and manage all agents
- Analytics (/v2/analytics): Track performance, costs, and usage metrics
- Billing (/v2/billing): Manage credits, subscriptions, and payment methods
- Settings (/v2/settings): Configure API keys, integrations, and preferences
- Create Agent (/agents/new): Build a new AI agent

Common UI elements:
- **Footer**: Contains Last Run time, Connected Plugins icons, Dark Mode toggle, + button (create agent), and 3-dot menu (navigation)
- **Active Agents Card**: Shows top 3 most active agents (click to see all)
- **System Alerts Card**: Displays failures in last 24 hours
- **Credit Usage Gauge**: Circular gauge showing available/used credits
- **3-dot Menu**: Quick navigation to Agent List, Dashboard, and Create Agent

Examples of good responses with links:
- "You can view all your agents on the [Agent List](/v2/agent-list) page."
- "To manage your subscription, visit [Billing](/v2/billing)."
- "Check your performance metrics in [Analytics](/v2/analytics)."
- "To create a new agent, click [here](/agents/new) or use the + button in the footer."

Answer the user's question based on the current page context. Be helpful and guide them to accomplish their goals.`
}

export async function POST(request: NextRequest) {
  // Determine which AI provider to use (priority: Groq > Keywords)
  const useGroq = process.env.GROQ_API_KEY && process.env.USE_GROQ_HELP_BOT === 'true'

  try {
    const { messages, pageContext } = await request.json()

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Invalid request: messages required' },
        { status: 400 }
      )
    }

    // Get the last user message
    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== 'user') {
      return NextResponse.json(
        { error: 'Last message must be from user' },
        { status: 400 }
      )
    }

    // Extract userId from request headers or use null for anonymous users
    const userId = request.headers.get('x-user-id') || null

    let response: string

    if (useGroq) {
      // Use Groq AI (FREE & FAST!) for intelligent responses
      try {
        const systemPrompt = buildSystemPrompt(pageContext)

        // Convert messages to AI format (only keep last 5 messages for context)
        const aiMessages = [
          { role: 'system' as const, content: systemPrompt },
          ...messages.slice(-5).map((msg: any) => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          }))
        ]

        const callContext = {
          userId: userId || 'anonymous',
          sessionId: request.headers.get('x-session-id') || undefined,
          feature: 'help_bot',
          component: 'help-bot-api',
          category: 'support',
          activity_type: 'help_interaction',
          activity_name: 'Help bot conversation',
          workflow_step: 'chat_response'
        }

        const groqProvider = new GroqProvider(process.env.GROQ_API_KEY!, aiAnalytics)

        const groqResponse = await groqProvider.chatCompletion(
          {
            model: 'llama-3.1-8b-instant', // Fast, free Llama 3.1 8B model
            messages: aiMessages,
            temperature: 0.7,
            max_tokens: 300
          },
          callContext
        )

        response = groqResponse.choices[0]?.message?.content || 'I apologize, but I could not generate a response. Please try again.'
      } catch (aiError) {
        console.error('Groq API error, falling back to keyword matching:', aiError)
        // Fallback to keyword matching if Groq fails
        response = findBestMatch(lastMessage.content, pageContext.path || '/v2/dashboard')
      }
    } else {
      // Use keyword-based matching (zero cost)
      response = findBestMatch(lastMessage.content, pageContext.path || '/v2/dashboard')
    }

    return NextResponse.json({ response })
  } catch (error: any) {
    console.error('Help bot error:', error)
    return NextResponse.json(
      { error: 'Failed to process your question. Please try again.' },
      { status: 500 }
    )
  }
}
