# How the Groq-Powered Help Bot Works

## 📖 Complete Technical Overview

This document explains exactly how the NeuronForge help bot uses Groq AI to provide intelligent, contextual responses to user questions.

---

## 🎯 High-Level Architecture

```
User Question
    ↓
Frontend (HelpBot.tsx)
    ↓ Sends: { messages, pageContext }
    ↓
Backend (/api/help-bot/route.ts)
    ↓ Builds: System Prompt (context)
    ↓
Groq Provider (groqProvider.ts)
    ↓ Sends to: Groq API
    ↓
Groq Servers
    ↓ Runs: Llama 3.1 8B on LPU hardware
    ↓ Generates: Smart answer based on context + training
    ↓
Backend
    ↓ Returns: { response: "..." }
    ↓
Frontend
    ↓ Displays: Formatted answer with **bold** text
    ↓
User sees helpful answer! 🎉
```

---

## 🔍 Step-by-Step Process

### Step 1: User Asks a Question

**User Action**: Clicks the help bot icon (bottom right) and types:
```
"Why does my dashboard only show 3 agents?"
```

**Location**: `components/v2/HelpBot.tsx`

---

### Step 2: Frontend Sends Request

The `HelpBot.tsx` component captures the message and sends it to the backend:

```typescript
// HelpBot.tsx - handleSend()
const headers: Record<string, string> = { 'Content-Type': 'application/json' }

// Add user ID to headers if authenticated
if (user?.id) {
  headers['x-user-id'] = user.id
}

const response = await fetch('/api/help-bot', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    messages: [...messages, userMessage],  // Conversation history
    pageContext: {
      title: 'Dashboard',
      path: '/v2/dashboard',
      description: 'Overview of your agents, credits, and activity'
    }
  })
})
```

**What's Sent**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Why does my dashboard only show 3 agents?"
    }
  ],
  "pageContext": {
    "title": "Dashboard",
    "path": "/v2/dashboard",
    "description": "Overview of your agents, credits, and activity"
  }
}
```

**Location**: `components/v2/HelpBot.tsx:127-146`

---

### Step 3: Backend Builds Context (System Prompt)

The API route creates a **system prompt** that gives Groq all the context it needs:

```typescript
// app/api/help-bot/route.ts
function buildSystemPrompt(pageContext: any): string {
  const pagePath = pageContext.path || '/v2/dashboard'
  const pageTitle = pageContext.title || 'NeuronForge'
  const pageDescription = pageContext.description || 'AI Agent Platform'

  return `You are a helpful assistant for NeuronForge, an AI Agent Platform.
You are currently helping users on the **${pageTitle}** page.

Page Description: ${pageDescription}
Current Path: ${pagePath}

Your role:
- Provide clear, concise answers about the current page and NeuronForge features
- Be friendly and conversational
- Use **bold** for emphasis on important terms
- Keep responses under 150 words
- If you mention UI elements, describe where they are located
- For navigation questions, provide step-by-step instructions

Available pages:
- Dashboard (/v2/dashboard): Overview of agents, credits, system alerts, and activity
- Agent List (/v2/agent-list): View, filter, and manage all agents
- Analytics (/v2/analytics): Track performance, costs, and usage metrics
- Billing (/v2/billing): Manage credits, subscriptions, and payment methods
- Settings (/v2/settings): Configure API keys, integrations, and preferences

Common UI elements:
- **Footer**: Contains Last Run time, Connected Plugins icons, Dark Mode toggle,
  + button (create agent), and 3-dot menu (navigation)
- **Active Agents Card**: Shows top 3 most active agents (click to see all)
- **System Alerts Card**: Displays failures in last 24 hours
- **Credit Usage Gauge**: Circular gauge showing available/used credits
- **3-dot Menu**: Quick navigation to Agent List, Dashboard, and Create Agent

Answer the user's question based on the current page context. Be helpful and
guide them to accomplish their goals.`
}
```

**Why This Matters**:
- Groq doesn't "know" about your app
- The system prompt **teaches** Groq about NeuronForge
- It's like giving a new employee a detailed manual

**Location**: `app/api/help-bot/route.ts:166-200`

---

### Step 4: Send to Groq API

The backend prepares the messages and sends them to Groq:

```typescript
// Build the messages array
const aiMessages = [
  {
    role: 'system',
    content: buildSystemPrompt(pageContext)  // The context/manual
  },
  {
    role: 'user',
    content: 'Why does my dashboard only show 3 agents?'  // The question
  }
]

// Initialize Groq provider
const groqProvider = new GroqProvider(process.env.GROQ_API_KEY!, aiAnalytics)

// Call Groq API
const groqResponse = await groqProvider.chatCompletion(
  {
    model: 'llama-3.1-8b-instant',  // The AI model (free & fast!)
    messages: aiMessages,
    temperature: 0.7,  // How creative (0 = deterministic, 1 = creative)
    max_tokens: 300    // Max response length (~150 words)
  },
  {
    userId: userId || 'anonymous',
    sessionId: request.headers.get('x-session-id') || undefined,
    feature: 'help_bot',
    component: 'help-bot-api',
    category: 'support',
    activity_type: 'help_interaction',
    activity_name: 'Help bot conversation',
    workflow_step: 'chat_response'
  }
)
```

**Parameters Explained**:
- `model`: Which AI model to use (we use Llama 3.1 8B - fast & free)
- `messages`: Array of system + user messages
- `temperature`: 0.7 = balanced between creative and focused
- `max_tokens`: 300 tokens ≈ 150 words

**Location**: `app/api/help-bot/route.ts:169-181`

---

### Step 5: Groq Processes with Llama 3.1

Groq's servers run **Meta's Llama 3.1 8B model** on their ultra-fast LPU hardware:

#### How Llama 3.1 Works:

1. **Reads the system prompt** → Understands:
   - It's helping with NeuronForge
   - User is on Dashboard page
   - Dashboard has an "Active Agents" card
   - The card shows top 3 agents

2. **Reads the user question** → Understands:
   - User is asking about agent count
   - Wants to know why only 3 agents are shown

3. **Uses its training** → Llama 3.1 has been trained on:
   - Billions of conversations
   - Technical documentation
   - Q&A forums
   - Code repositories

4. **Combines context + training** → Generates an intelligent answer:
   - Explains the "top 3" design decision
   - Provides step-by-step navigation
   - Uses **bold** formatting as instructed
   - Keeps response under 150 words

#### What Makes Groq Fast?

| Traditional AI | Groq |
|---------------|------|
| **Hardware**: GPUs (Graphics Processing Units) | **LPUs** (Language Processing Units) |
| **Speed**: 40 tokens/sec | **300+ tokens/sec** |
| **Purpose**: General purpose | **Optimized for AI inference** |
| **Latency**: 2-5 seconds | **<1 second** |

**Groq's Secret**: Custom silicon designed specifically for running large language models!

---

### Step 6: Groq Returns Answer

Groq sends back a structured response:

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1762972240,
  "model": "llama-3.1-8b-instant",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The **Active Agents** card on your dashboard shows only the **top 3 most active agents** to keep the interface clean and focused. This design helps you quickly see your most frequently running agents without overwhelming the view.\n\nTo see all your agents:\n1. Click directly on the **Active Agents** card title\n2. Look for the \"+X more\" text and click it\n3. Or use the **3-dot menu** in the footer → select **Agent List**\n\nThis will take you to the full agent list where you can view, filter, and manage all your agents."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 450,
    "completion_tokens": 110,
    "total_tokens": 560
  }
}
```

**Response Fields**:
- `choices[0].message.content`: The actual answer
- `usage`: Token counts for analytics
- `finish_reason`: "stop" means completed successfully

**Location**: Returned from `lib/ai/providers/groqProvider.ts:54-62`

---

### Step 7: Backend Extracts Response

```typescript
// Extract the answer from Groq's response
response = groqResponse.choices[0]?.message?.content ||
           'I apologize, but I could not generate a response. Please try again.'

// Return to frontend
return NextResponse.json({ response })
```

**Fallback Logic**: If Groq fails, falls back to keyword matching:

```typescript
} catch (aiError) {
  console.error('AI API error, falling back to keyword matching:', aiError)
  response = findBestMatch(lastMessage.content, pageContext.path || '/v2/dashboard')
}
```

**Location**: `app/api/help-bot/route.ts:183, 200-204`

---

### Step 8: Frontend Displays Response

The HelpBot component receives the response and renders it with markdown formatting:

```typescript
// HelpBot.tsx
const data = await response.json()

const assistantMessage: Message = {
  role: 'assistant',
  content: data.response
}

setMessages((prev) => [...prev, assistantMessage])
```

**Markdown Rendering**:
```typescript
// Convert **bold** to <strong>
function renderMarkdown(text: string) {
  const withBold = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  const withLinks = withBold.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"
       class="text-blue-500 hover:underline">$1</a>'
  )
  return withLinks
}
```

**What User Sees**:
```
The Active Agents card on your dashboard shows only the top 3 most active
agents to keep the interface clean and focused. This design helps you quickly
see your most frequently running agents without overwhelming the view.

To see all your agents:
1. Click directly on the Active Agents card title
2. Look for the "+X more" text and click it
3. Or use the 3-dot menu in the footer → select Agent List

This will take you to the full agent list where you can view, filter, and
manage all your agents.
```

**Location**: `components/v2/HelpBot.tsx:147-151, 70-82`

---

## 🧠 Why Does Groq Give Good Answers?

### 1. **System Prompt (Context)**

We give Groq detailed information about:
- ✅ What page the user is on
- ✅ What features exist on that page
- ✅ Where UI elements are located
- ✅ How to navigate
- ✅ Formatting guidelines (bold, word count, etc.)

### 2. **Llama 3.1 Training**

Meta's Llama 3.1 model was trained on:
- ✅ Billions of web pages
- ✅ Millions of conversations
- ✅ Technical documentation
- ✅ Q&A forums (Stack Overflow, Reddit, etc.)
- ✅ Code repositories

**Result**: It "learned" how to:
- Understand complex questions
- Structure helpful answers
- Be conversational and friendly
- Format responses with markdown
- Provide step-by-step instructions

### 3. **Conversation Memory**

We send the **last 5 messages** so Groq remembers context:

```typescript
messages.slice(-5)  // Keep last 5 messages for context
```

**Example**:
```
User: "How do I create an agent?"
Bot: "Click the + button in the footer or use the search bar..."

User: "Where is the footer?"  ← Groq knows we're talking about the same thing!
Bot: "The footer is at the bottom of the page, below all content..."

User: "What's in it?"  ← Groq still remembers we're discussing the footer!
Bot: "The footer contains Last Run time, Connected Plugins icons, Dark Mode..."
```

**Why This Works**: Groq sees the full conversation history, so it understands:
- "it" refers to the footer
- User is exploring the UI step-by-step
- Context from previous answers

---

## 🔄 Fallback System

The help bot has a **three-tier fallback** system:

### Tier 1: Groq AI (Primary)
```typescript
if (useGroq) {
  // Use Groq (FREE & FAST!)
  const groqProvider = new GroqProvider(process.env.GROQ_API_KEY!, aiAnalytics)
  const groqResponse = await groqProvider.chatCompletion(...)
  response = groqResponse.choices[0]?.message?.content
}
```

### Tier 2: Mistral AI (Secondary - if enabled)
```typescript
else if (useMistral) {
  // Use Mistral (paid alternative)
  const mistralProvider = new MistralProvider(process.env.MISTRAL_API_KEY!, aiAnalytics)
  const mistralResponse = await mistralProvider.chatCompletion(...)
  response = mistralResponse.choices[0]?.message?.content
}
```

### Tier 3: Keyword Matching (Always Available)
```typescript
else {
  // Use keyword-based matching (zero cost)
  response = findBestMatch(lastMessage.content, pageContext.path || '/v2/dashboard')
}
```

**Plus Error Fallback**:
```typescript
catch (aiError) {
  console.error('AI API error, falling back to keyword matching:', aiError)
  response = findBestMatch(lastMessage.content, pageContext.path || '/v2/dashboard')
}
```

**Result**: The help bot **never fails** - it always provides a response!

---

## 📊 Analytics Tracking

Every AI call is tracked for cost monitoring and performance analysis:

```typescript
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
```

**What's Tracked**:
- ✅ User ID (if logged in)
- ✅ Session ID
- ✅ Provider used (Groq/Mistral)
- ✅ Model used (llama-3.1-8b-instant)
- ✅ Token usage (input + output)
- ✅ Cost (for Groq = $0!)
- ✅ Latency (response time)
- ✅ Success/failure status

**Query Analytics**:
```sql
SELECT
  DATE(created_at) as date,
  provider,
  model_name,
  COUNT(*) as total_calls,
  SUM(input_tokens) as input_tokens,
  SUM(output_tokens) as output_tokens,
  AVG(latency_ms) as avg_latency_ms,
  SUM(cost_usd) as total_cost
FROM ai_analytics
WHERE feature = 'help_bot'
GROUP BY DATE(created_at), provider, model_name
ORDER BY date DESC;
```

---

## 🆚 Groq vs Keywords - Comparison

### Keyword Matching (Old Way)

```typescript
// Predefined database
const QA_DATABASE = {
  '/v2/dashboard': {
    'three agents|only three|top 3': 'The Active Agents card shows only...'
  }
}

// Matching logic
if (query.includes('three agents')) {
  return predefinedAnswer
}
```

**Limitations**:
- ❌ Must match exact keywords
- ❌ Can't handle variations
- ❌ No conversation memory
- ❌ Requires manual updates
- ❌ Not truly conversational

### Groq AI (New Way)

```typescript
// Dynamic context
const systemPrompt = buildSystemPrompt(pageContext)

// AI processing
const groqResponse = await groqProvider.chatCompletion({
  model: 'llama-3.1-8b-instant',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userQuestion }
  ]
})
```

**Advantages**:
- ✅ Understands natural language
- ✅ Handles variations ("why only 3", "show 3 agents", "limited agents")
- ✅ Remembers conversation
- ✅ Auto-updates with system prompt changes
- ✅ Truly conversational
- ✅ Can reason and explain

### Example Comparison

**Question**: "Why only 3 agents showing?"

**Keyword Response**:
```
The Active Agents card shows only the top 3 most active agents to save
space. Click the card or "+X more" text to view all agents.
```
*Matches keyword "three agents" → returns predefined answer*

**Groq AI Response**:
```
The Active Agents card on your dashboard shows only the top 3 most active
agents to keep the interface clean and focused. This design helps you
quickly see your most frequently running agents without overwhelming the view.

To see all your agents:
1. Click directly on the Active Agents card title
2. Look for the "+X more" text and click it
3. Or use the 3-dot menu in the footer → select Agent List

This will take you to the full agent list where you can view, filter, and
manage all your agents.
```
*Understands question → reasons about UI design → provides multiple options*

---

## 🎛️ Configuration Options

### Environment Variables

```bash
# Groq (Primary - FREE)
GROQ_API_KEY=gsk_your_key_here
USE_GROQ_HELP_BOT=true

# Mistral (Secondary - Paid)
MISTRAL_API_KEY=your_key_here
USE_MISTRAL_HELP_BOT=false  # Set to true to use Mistral instead

# Supabase (Required for analytics)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Model Selection

In `app/api/help-bot/route.ts`:

```typescript
// Current (recommended)
model: 'llama-3.1-8b-instant'  // Fast & free

// Alternatives
model: 'llama-3.1-70b-versatile'  // Smarter but slower
model: 'mixtral-8x7b-32768'  // Good for long context
```

### Response Tuning

```typescript
temperature: 0.7,  // 0.0-1.0 (higher = more creative)
max_tokens: 300,   // Max response length (~150 words)
```

**Temperature Guide**:
- `0.0-0.3`: Focused, deterministic (good for facts)
- `0.4-0.7`: Balanced (recommended)
- `0.8-1.0`: Creative, varied (good for brainstorming)

---

## 🔧 How to Customize

### Add New Page Context

Edit `components/v2/HelpBot.tsx`:

```typescript
const PAGE_CONTEXTS: Record<string, PageContext> = {
  '/v2/new-page': {
    title: 'New Page',
    description: 'What this page does',
    helpTopics: [
      'How do I use feature X?',
      'Where is button Y?',
      'What does Z mean?',
    ],
  },
}
```

### Update System Prompt

Edit `app/api/help-bot/route.ts` → `buildSystemPrompt()`:

```typescript
Common UI elements:
- **Footer**: Contains Last Run time...
- **New Feature**: Add your new UI element here
```

### Add Keyword Fallbacks

Edit `app/api/help-bot/route.ts` → `QA_DATABASE`:

```typescript
'/v2/dashboard': {
  'new feature|feature name': 'Description and instructions...',
}
```

---

## 🐛 Troubleshooting

### Groq Not Responding

**Check**:
1. Is `GROQ_API_KEY` set in `.env.local`?
2. Is `USE_GROQ_HELP_BOT=true`?
3. Did you restart the dev server?
4. Check console for error messages

**Fallback**: Bot automatically uses keyword matching if Groq fails

### Analytics Errors

**Error**: `invalid input syntax for type uuid: "anonymous"`

**Fix**: Already implemented! The bot now:
- Sends user ID if logged in
- Uses `null` for anonymous users
- Doesn't break if analytics fail

### Slow Responses

**Causes**:
- Using `llama-3.1-70b-versatile` instead of `8b-instant`
- High `max_tokens` value
- Network latency

**Fix**:
```typescript
model: 'llama-3.1-8b-instant',  // Fast model
max_tokens: 200,  // Shorter responses
```

### Generic Answers

**Problem**: Groq doesn't have enough context

**Fix**: Enhance system prompt with more details:
```typescript
function buildSystemPrompt(pageContext: any): string {
  return `...

  Additional context:
  - Specific feature details
  - Common user workflows
  - Troubleshooting tips
  `
}
```

---

## 📈 Performance Metrics

### Typical Response Times

| Provider | Average Latency |
|----------|----------------|
| Groq (8B) | 500-1000ms |
| Groq (70B) | 1500-2500ms |
| Mistral | 1000-2000ms |
| Keywords | <50ms |

### Token Usage

**Typical conversation**:
- System prompt: ~450 tokens
- User question: ~15 tokens
- Bot response: ~100 tokens
- **Total**: ~565 tokens per message

**Cost** (with Groq): **$0.00** ✨

---

## 🚀 Future Enhancements

Potential improvements:

### 1. Streaming Responses
Show response as it's being generated:
```typescript
stream: true,  // Enable streaming
```

### 2. RAG (Retrieval Augmented Generation)
Add document search:
```typescript
// Search knowledge base
const docs = await searchDocs(query)
// Include in system prompt
systemPrompt += `\n\nRelevant docs: ${docs}`
```

### 3. Voice Input
Add speech-to-text:
```typescript
// Use Web Speech API
const recognition = new SpeechRecognition()
```

### 4. Multi-language
Detect language and respond accordingly:
```typescript
const userLang = detectLanguage(query)
systemPrompt += `\n\nRespond in ${userLang}`
```

### 5. Proactive Suggestions
Suggest help based on user behavior:
```typescript
// User hovering over element for 5+ seconds
showHelpSuggestion("Need help with this?")
```

---

## 📚 Resources

### Groq
- **Docs**: https://console.groq.com/docs
- **Playground**: https://console.groq.com/playground
- **Models**: https://console.groq.com/docs/models
- **API Reference**: https://console.groq.com/docs/api-reference

### Llama 3.1
- **Announcement**: https://ai.meta.com/blog/meta-llama-3-1/
- **Model Card**: https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct
- **Paper**: https://arxiv.org/abs/2407.21783

### Code Locations
- **Frontend**: `components/v2/HelpBot.tsx`
- **Backend**: `app/api/help-bot/route.ts`
- **Groq Provider**: `lib/ai/providers/groqProvider.ts`
- **Mistral Provider**: `lib/ai/providers/mistralProvider.ts`
- **Base Provider**: `lib/ai/providers/baseProvider.ts`

---

## ✅ Summary

**How it works**:
1. User asks question → Frontend captures it
2. Frontend sends to API → Includes page context
3. API builds system prompt → Teaches Groq about your app
4. API calls Groq → Sends context + question
5. Groq processes with Llama 3.1 → Generates smart answer
6. API returns response → Frontend displays with formatting
7. User sees helpful answer → Fast, free, and intelligent!

**Key Technologies**:
- **Groq**: Ultra-fast AI inference (FREE!)
- **Llama 3.1**: Meta's open-source language model
- **Next.js**: API routes and React components
- **TypeScript**: Type-safe implementation
- **Supabase**: Analytics storage

**Why it's awesome**:
- ✅ 100% FREE (with Groq)
- ✅ Blazing fast (300+ tokens/sec)
- ✅ Actually intelligent (understands context)
- ✅ Conversational (remembers history)
- ✅ Always available (keyword fallback)
- ✅ Fully tracked (analytics on every call)

---

**Questions?** Check the [Groq documentation](https://console.groq.com/docs) or the code!
