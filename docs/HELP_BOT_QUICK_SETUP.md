# Help Bot - Quick Setup ⚡

## 3-Minute Setup with FREE Groq AI

### Step 1: Get API Key (1 min)
```
🌐 Visit: https://console.groq.com/
📧 Sign up (free)
🔑 Get API key (starts with gsk_)
```

### Step 2: Configure (30 sec)
Add to `.env.local`:
```bash
GROQ_API_KEY=gsk_your_key_here
USE_GROQ_HELP_BOT=true
```

### Step 3: Restart (30 sec)
```bash
npm run dev
```

### Step 4: Test (1 min)
Click the help bot icon and ask:
```
"Why does my dashboard only show 3 agents?"
```

---

## Why Groq?

| Feature | Value |
|---------|-------|
| Cost | **100% FREE** |
| Speed | **300+ tokens/sec** |
| Quality | **Llama 3.1 (Meta)** |
| Limits | **30 req/min** |
| Setup | **3 minutes** |

---

## Models Available

```typescript
// Fast (recommended for help bot)
'llama-3.1-8b-instant'

// Powerful (for complex questions)
'llama-3.1-70b-versatile'

// Alternative
'mixtral-8x7b-32768'
```

---

## Configuration Options

### Use Groq (FREE)
```bash
GROQ_API_KEY=gsk_xxx
USE_GROQ_HELP_BOT=true
```

### Use Mistral (Paid ~$0.15/1K interactions)
```bash
MISTRAL_API_KEY=xxx
USE_MISTRAL_HELP_BOT=true
```

### Use Keywords (FREE, no AI)
```bash
# Don't set any API keys
# Or set both to false
```

---

## Priority Order
1. ✅ Groq (if configured)
2. ✅ Mistral (if Groq not available)
3. ✅ Keywords (always available as fallback)

---

## Test Questions

Try these to see it in action:

```
1. "How do I create a new agent?"
2. "What does the credit gauge show?"
3. "Where can I find all my agents?"
4. "How do I export my analytics?"
```

---

## Monitoring

**Groq Dashboard**: https://console.groq.com/

**Your Analytics**:
```sql
SELECT provider, COUNT(*) as calls
FROM ai_analytics
WHERE feature = 'help_bot'
GROUP BY provider;
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "API error" | Check `.env.local` has correct key |
| Slow responses | Use `llama-3.1-8b-instant` |
| Rate limit | Wait 1 min or upgrade Groq plan |
| Generic answers | Tune system prompt in code |

---

## Cost Comparison

```
Groq:     $0.00  (FREE!)    ⭐⭐⭐⭐⭐
Mistral:  $0.15/1K
GPT-4:    $30/1K
Keywords: $0.00  (no AI)
```

---

## Files Modified

- ✅ `lib/ai/providers/groqProvider.ts` (new)
- ✅ `lib/ai/providers/mistralProvider.ts` (new)
- ✅ `app/api/help-bot/route.ts` (updated)
- ✅ `components/v2/HelpBot.tsx` (renders markdown)

---

## Ready to Go!

Your help bot now supports:
- 🤖 FREE AI with Groq
- 💬 Conversational responses
- 📍 Page-aware context
- 🔄 Automatic fallback
- 📊 Full analytics

**Get started**: https://console.groq.com/
