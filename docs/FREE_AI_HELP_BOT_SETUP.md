# FREE AI Help Bot Setup Guide 🚀

## Overview

Your NeuronForge help bot now supports **FREE AI models** for intelligent responses! This guide shows you how to use **Groq** (recommended) or other free alternatives.

---

## 🌟 Option 1: Groq (RECOMMENDED - 100% FREE!)

### Why Groq?
- ✅ **Completely FREE** - No credit card required
- ✅ **Blazing fast** - 300+ tokens/second (faster than GPT-4!)
- ✅ **High quality** - Uses Meta's Llama 3.1 models
- ✅ **Generous limits** - 30 requests/minute free tier
- ✅ **OpenAI-compatible** - Easy to integrate

### Setup Groq in 3 Minutes

#### 1. Get Your FREE Groq API Key

1. Visit [https://console.groq.com/](https://console.groq.com/)
2. Click **"Sign Up"** (or **"Sign In"** if you have an account)
3. Verify your email
4. Go to **"API Keys"** in the sidebar
5. Click **"Create API Key"**
6. Copy your API key (starts with `gsk_...`)

#### 2. Add to Environment Variables

Open your `.env.local` file and add:

```bash
# Groq AI Configuration (FREE!)
GROQ_API_KEY=gsk_your_groq_api_key_here
USE_GROQ_HELP_BOT=true
```

#### 3. Restart Your Server

```bash
npm run dev
```

**That's it!** Your help bot now uses FREE Groq AI! 🎉

### Available Groq Models

```typescript
// In /app/api/help-bot/route.ts, you can change the model:

model: 'llama-3.1-8b-instant',  // Default - Fast & smart (RECOMMENDED)
// OR
model: 'llama-3.1-70b-versatile',  // Larger model - smarter but slower
// OR
model: 'mixtral-8x7b-32768',  // Alternative - good for long context
```

### Groq Rate Limits (Free Tier)

- **Requests**: 30 per minute
- **Tokens**: 14,400 per minute
- **Daily limit**: ~600,000 tokens/day

**More than enough for a help bot!**

---

## 💰 Option 2: Mistral (Low Cost - ~$0.00015/interaction)

If you prefer Mistral over Groq:

### Setup Mistral

1. Visit [https://console.mistral.ai/](https://console.mistral.ai/)
2. Sign up and get an API key
3. Add to `.env.local`:

```bash
MISTRAL_API_KEY=your_mistral_api_key_here
USE_MISTRAL_HELP_BOT=true
```

**Note**: Groq takes priority if both are enabled. To use Mistral, set `USE_GROQ_HELP_BOT=false`.

---

## 🔄 Option 3: Fallback to Keywords (Zero Cost)

If you don't want to use any AI:

```bash
# Leave both disabled (or remove these lines)
USE_GROQ_HELP_BOT=false
USE_MISTRAL_HELP_BOT=false
```

The bot will use the enhanced keyword-matching system (works well for FAQ-style questions).

---

## 🎯 Priority Order

The help bot uses this priority:

1. **Groq** (if `GROQ_API_KEY` + `USE_GROQ_HELP_BOT=true`)
2. **Mistral** (if Groq not available and `MISTRAL_API_KEY` + `USE_MISTRAL_HELP_BOT=true`)
3. **Keywords** (if no AI configured)

---

## 🧪 Testing Your Setup

### Test with These Questions:

1. **Navigation**: "How do I create a new agent?"
2. **Complex**: "Why does my dashboard only show 3 agents and how can I see all of them?"
3. **Troubleshooting**: "What should I do if my agent fails?"
4. **Exploration**: "Can you explain what the credit gauge means?"

### Check It's Working

Open your browser console and look for:
- ✅ No errors
- ✅ Fast responses (<2 seconds with Groq)
- ✅ Natural, conversational answers

---

## 📊 Cost Comparison

| Provider | Cost per 1K interactions | Speed | Quality |
|----------|-------------------------|-------|---------|
| **Groq** | **$0.00** (FREE!) | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ |
| Mistral | $0.15 | ⚡⚡⚡ | ⭐⭐⭐⭐ |
| Keywords | $0.00 | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ |
| GPT-4 | $30.00 | ⚡⚡ | ⭐⭐⭐⭐⭐ |

**Winner**: Groq offers the best value - fast, free, and smart!

---

## 🔧 Advanced Configuration

### Adjust Response Length

In `/app/api/help-bot/route.ts`:

```typescript
max_tokens: 300,  // Default (150-word responses)
// Increase to 500 for longer responses
// Decrease to 200 for shorter responses
```

### Adjust Temperature (Creativity)

```typescript
temperature: 0.7,  // Default (balanced)
// 0.3 = More focused, deterministic
// 1.0 = More creative, varied
```

### Change Model

For Groq:

```typescript
// Fast & efficient (default)
model: 'llama-3.1-8b-instant',

// More powerful (slower, but smarter)
model: 'llama-3.1-70b-versatile',
```

---

## 🐛 Troubleshooting

### "Groq API error" in Console

**Possible causes:**
1. Invalid API key - Check your `.env.local`
2. Rate limit exceeded - Wait a minute and try again
3. Network issue - Check your internet connection

**Solution**: The bot automatically falls back to keyword matching.

### Responses Are Too Generic

**Solution**: The system prompt might need tuning. Edit `buildSystemPrompt()` in `/app/api/help-bot/route.ts` to add more specific information about your UI.

### Bot Is Too Slow

**Solution**:
1. Make sure you're using Groq (not Mistral)
2. Use `llama-3.1-8b-instant` (not the 70B model)
3. Reduce `max_tokens` to 200

### API Key Not Working

**Check:**
```bash
# In your terminal:
echo $GROQ_API_KEY

# Should output your key (gsk_...)
# If empty, restart your dev server after adding to .env.local
```

---

## 📈 Monitoring Usage

### Check Groq Usage

Visit [https://console.groq.com/](https://console.groq.com/) → **Usage**

### Check Analytics in Your App

Query your analytics:

```sql
SELECT
  DATE(created_at) as date,
  provider,
  COUNT(*) as total_calls,
  SUM(input_tokens) as input_tokens,
  SUM(output_tokens) as output_tokens,
  AVG(latency_ms) as avg_latency_ms
FROM ai_analytics
WHERE feature = 'help_bot'
GROUP BY DATE(created_at), provider
ORDER BY date DESC;
```

---

## 🚀 Other Free AI Options

### HuggingFace Inference API

Free tier available for many models:
- **URL**: https://huggingface.co/inference-api
- **Models**: 1000+ open-source models
- **Setup**: Get API token → add to `.env.local`

### Together AI

Free credits to start:
- **URL**: https://together.ai/
- **Models**: Llama 3.1, Mixtral, etc.
- **Pricing**: $5 free credits

### Ollama (Run Locally)

100% free, runs on your machine:
- **URL**: https://ollama.ai/
- **Models**: Download and run locally
- **Pros**: Completely free, private
- **Cons**: Slower, requires good hardware

---

## 🎓 Best Practices

### 1. Start with Groq
It's free and fast - perfect for testing!

### 2. Monitor Usage
Check your Groq dashboard weekly to ensure you're within limits.

### 3. Implement Caching (Optional)
For repeated questions, consider caching responses to save API calls.

### 4. Keep Keyword Fallback
The keyword system is a great backup if AI fails.

---

## 📝 Environment Variables Summary

```bash
# === GROQ (Recommended - FREE) ===
GROQ_API_KEY=gsk_your_key_here
USE_GROQ_HELP_BOT=true

# === MISTRAL (Optional - Low Cost) ===
# MISTRAL_API_KEY=your_key_here
# USE_MISTRAL_HELP_BOT=true

# Note: Groq takes priority if both are enabled
```

---

## 🎉 Quick Start (Copy & Paste)

1. **Sign up for Groq**: https://console.groq.com/
2. **Copy your API key**
3. **Add to `.env.local`**:
   ```bash
   GROQ_API_KEY=gsk_your_key_here
   USE_GROQ_HELP_BOT=true
   ```
4. **Restart**: `npm run dev`
5. **Test**: Click the help bot and ask a question!

---

## 📚 Resources

- **Groq Docs**: https://console.groq.com/docs
- **Groq Playground**: https://console.groq.com/playground
- **Groq Models**: https://console.groq.com/docs/models
- **Llama 3.1 Info**: https://ai.meta.com/blog/meta-llama-3-1/

---

## 💡 Pro Tips

1. **Groq is production-ready** - Many companies use it for customer support
2. **Monitor your quota** - Set up alerts in Groq dashboard
3. **Test different models** - Try both 8B and 70B to see what works best
4. **Combine with keywords** - Use AI for complex questions, keywords for simple FAQ

---

**Questions?** Check the Groq documentation or open an issue!

Happy building! 🚀
