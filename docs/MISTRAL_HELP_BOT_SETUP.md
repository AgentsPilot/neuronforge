# Mistral-7B Help Bot Setup Guide

## Overview

The NeuronForge help bot now supports **Mistral-7B AI** for intelligent, conversational responses. This provides a much better user experience compared to keyword-based matching, while keeping costs very low.

## Features

- **Intelligent Responses**: Mistral-7B understands context and provides natural, helpful answers
- **Page-Aware**: The bot knows which page the user is on and provides relevant guidance
- **Conversational Memory**: Keeps track of the last 5 messages for context
- **Cost-Efficient**: Uses `mistral-tiny` model (~$0.14 input / $0.42 output per 1M tokens)
- **Fallback System**: Automatically falls back to keyword matching if Mistral API fails
- **Analytics Tracking**: All AI calls are tracked for cost monitoring

## Setup Instructions

### 1. Get a Mistral API Key

1. Visit [https://console.mistral.ai/](https://console.mistral.ai/)
2. Sign up or log in to your account
3. Navigate to **API Keys** section
4. Create a new API key
5. Copy the API key (you won't be able to see it again)

### 2. Add Environment Variables

Add the following to your `.env.local` file:

```bash
# Mistral AI Configuration
MISTRAL_API_KEY=your_mistral_api_key_here
USE_MISTRAL_HELP_BOT=true  # Set to 'true' to enable Mistral, 'false' for keyword matching
```

### 3. Restart Your Development Server

```bash
npm run dev
```

The help bot will now use Mistral-7B for all responses!

## Configuration Options

### Model Selection

By default, the help bot uses `mistral-tiny` for cost efficiency. You can change this in `/app/api/help-bot/route.ts`:

```typescript
model: 'mistral-tiny',  // Options: mistral-tiny, mistral-small, mistral-medium
```

**Model Pricing (approximate):**
- `mistral-tiny`: $0.14 / $0.42 per 1M tokens (input/output)
- `mistral-small`: $0.60 / $1.80 per 1M tokens
- `mistral-medium`: $2.50 / $7.50 per 1M tokens

### Response Length

Adjust `max_tokens` to control response length:

```typescript
max_tokens: 300,  // Max 300 tokens (~150 words)
```

### Temperature

Control response creativity:

```typescript
temperature: 0.7,  // Range: 0.0 (deterministic) to 1.0 (creative)
```

## How It Works

### 1. User Asks a Question

When a user types a question in the help bot, the frontend sends:
- The conversation history (last 5 messages)
- Current page context (path, title, description)
- User ID (for analytics)

### 2. System Prompt is Built

The API builds a comprehensive system prompt that includes:
- Page-specific information
- Available features and navigation
- UI element locations
- Role and response guidelines

### 3. Mistral Generates Response

Mistral-7B processes:
- System prompt (context)
- Conversation history
- Current user question

And generates an intelligent, contextual response.

### 4. Fallback Mechanism

If Mistral API fails for any reason:
- Automatically falls back to keyword-based matching
- Uses the enhanced fuzzy matching system
- Ensures users always get a response

## Monitoring Costs

All Mistral API calls are tracked in the `ai_analytics` table:

```sql
SELECT
  DATE(created_at) as date,
  COUNT(*) as total_calls,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cost_usd) as total_cost
FROM ai_analytics
WHERE feature = 'help_bot'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Typical Costs

Based on average usage:
- Average question: ~500 input tokens, ~200 output tokens
- Cost per interaction: ~$0.00015 USD
- **1000 help bot interactions ≈ $0.15 USD**

## Testing

### Enable Mistral

```bash
USE_MISTRAL_HELP_BOT=true
```

### Disable Mistral (use keyword matching)

```bash
USE_MISTRAL_HELP_BOT=false
```

### Test Questions

Try these questions to see Mistral in action:

1. "Why are only 3 agents shown on the dashboard?"
2. "How do I create a new agent?"
3. "What does the credit gauge mean?"
4. "Where can I find all my agents?"
5. "How do I export my analytics data?"

## Comparison: Mistral vs Keyword Matching

| Feature | Mistral-7B | Keyword Matching |
|---------|-----------|------------------|
| Intelligence | High - understands context | Limited - exact matches |
| Conversational | Yes - remembers context | No - one-off responses |
| Natural Language | Excellent | Good for predefined queries |
| Cost | ~$0.00015 per interaction | Free (zero cost) |
| Response Quality | Excellent | Good for FAQ |
| Fallback | Automatic | N/A |

## Troubleshooting

### "Mistral API error" in logs

**Check:**
1. Is your `MISTRAL_API_KEY` correct in `.env.local`?
2. Do you have API credits in your Mistral account?
3. Is there a network connectivity issue?

The bot will automatically fallback to keyword matching.

### Responses are too short/long

Adjust `max_tokens` in `/app/api/help-bot/route.ts`:
- Too short: Increase to 500
- Too long: Decrease to 200

### Responses are not contextual enough

The system prompt may need adjustment. Edit `buildSystemPrompt()` in `/app/api/help-bot/route.ts` to include more specific information about your UI.

## Future Enhancements

Potential improvements:
- **Streaming responses**: Show responses as they're generated
- **Knowledge base**: Add RAG (Retrieval Augmented Generation) for documentation
- **Multi-language**: Support multiple languages
- **Voice input**: Add speech-to-text
- **Analytics dashboard**: Dedicated view for help bot metrics

## Architecture

```
User Question
    ↓
HelpBot.tsx (Frontend)
    ↓
/api/help-bot (API Route)
    ↓
[Check: USE_MISTRAL_HELP_BOT?]
    ↓
    ├─ YES → MistralProvider
    │           ↓
    │        Mistral API
    │           ↓
    │        [Success?]
    │           ↓
    │           ├─ YES → Response
    │           └─ NO → Fallback to Keywords
    │
    └─ NO → Keyword Matching
                ↓
             Response
```

## License

This integration uses:
- **Mistral AI**: Subject to Mistral AI Terms of Service
- **NeuronForge**: Your project license

---

**Questions?** Check the Mistral documentation at [https://docs.mistral.ai/](https://docs.mistral.ai/)
