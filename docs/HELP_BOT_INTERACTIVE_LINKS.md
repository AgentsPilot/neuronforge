# Help Bot Interactive Links 🔗

## Overview

Your help bot now includes **interactive navigation links** that allow users to click directly to relevant pages from within chat responses!

---

## ✨ Features

### 1. **Clickable Navigation Links**
When users ask about specific features or pages, the help bot automatically includes clickable links:

**Example interactions:**
- User: "How do I see all my agents?"
- Bot: "You can view all your agents on the [Agent List](/v2/agent-list) page."
  - ➡️ Clicking "[Agent List]" navigates to `/v2/agent-list` and closes the help bot

- User: "Where can I manage my billing?"
- Bot: "Visit [Billing](/v2/billing) to manage your subscription and credits."

### 2. **Both AI and Keyword Responses Include Links**

Whether using **Groq AI** or **keyword matching**, both systems now support interactive links:

- **Groq AI**: Instructed via system prompt to include markdown links `[text](url)`
- **Keyword Database**: Pre-configured with markdown links in all responses

### 3. **Smart Link Rendering**

The help bot distinguishes between:
- **Internal links** (starting with `/`) → Use Next.js router for instant navigation
- **External links** (starting with `http`) → Open in new tab
- **Plain URLs** → Auto-convert to clickable external links

---

## 🛠️ Implementation Details

### **Frontend (HelpBot.tsx)**

#### Enhanced Markdown Renderer
```typescript
function renderMarkdown(text: string) {
  // Convert **bold** to <strong>
  let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  // Convert markdown links [text](url) to clickable links
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      if (url.startsWith('/')) {
        // Internal link - handled by router
        return `<a href="${url}" class="text-blue-500 hover:underline font-medium cursor-pointer internal-link" data-path="${url}">${linkText}</a>`
      } else if (url.startsWith('http')) {
        // External link
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline font-medium">${linkText}</a>`
      }
      return match
    }
  )

  return processed
}
```

#### Click Handler
```typescript
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
```

### **Backend (help-bot/route.ts)**

#### System Prompt Instructions for Groq AI
```typescript
Your role:
- **IMPORTANT**: When users ask about specific pages or features, include clickable navigation links using this format: [Link Text](/path)

Available pages (use these exact paths for links):
- Dashboard (/v2/dashboard)
- Agent List (/v2/agent-list)
- Analytics (/v2/analytics)
- Billing (/v2/billing)
- Settings (/v2/settings)
- Create Agent (/agents/new)

Examples of good responses with links:
- "You can view all your agents on the [Agent List](/v2/agent-list) page."
- "To manage your subscription, visit [Billing](/v2/billing)."
```

#### Keyword Database with Links
```typescript
const QA_DATABASE = {
  '/v2/dashboard': {
    'all agents': 'To see your complete agent list, visit the [Agent List](/v2/agent-list) page.',
    'credits': 'Click the gauge or visit [Billing](/v2/billing) to manage your credits.',
    'create agent': 'You can also go directly to [Create Agent](/agents/new).',
    'navigation': 'You can navigate to different sections:\n- [Agent List](/v2/agent-list): View all agents\n- [Analytics](/v2/analytics): Performance metrics\n- [Billing](/v2/billing): Manage credits',
  }
}
```

---

## 🎯 Supported Navigation Paths

| Link Text | Path | Destination |
|-----------|------|-------------|
| Dashboard | `/v2/dashboard` | Main overview page |
| Agent List | `/v2/agent-list` | All agents with filters |
| Analytics | `/v2/analytics` | Performance & cost tracking |
| Billing | `/v2/billing` | Credits & subscriptions |
| Settings | `/v2/settings` | Account configuration |
| Create Agent | `/agents/new` | Agent creation wizard |

---

## 💡 Examples of Interactive Responses

### Example 1: Finding Agents
```
User: "Where can I find all my agents?"

Bot: "You can view all your agents on the [Agent List](/v2/agent-list) page.
     Each agent card displays: Name, Status badge, Last run time, and Execution count."

[User clicks "Agent List" → Navigates to /v2/agent-list, help bot closes]
```

### Example 2: Managing Credits
```
User: "How do I buy more credits?"

Bot: "Visit [Billing](/v2/billing) and click Add Credits to purchase more.
     Credits are added instantly to your balance. We accept all major payment methods."

[User clicks "Billing" → Navigates to /v2/billing]
```

### Example 3: Multiple Links
```
User: "Show me where everything is"

Bot: "You can navigate to different sections:
     - [Agent List](/v2/agent-list): View all agents
     - [Analytics](/v2/analytics): Performance metrics
     - [Billing](/v2/billing): Manage credits
     - [Create Agent](/agents/new): Build new agent
     - [Settings](/v2/settings): Configure account"

[User can click any link to navigate]
```

---

## 🎨 Link Styling

Links are styled with:
- **Color**: `text-blue-500` (blue, readable on both light/dark themes)
- **Hover**: Underline on hover (`hover:underline`)
- **Font**: Medium weight (`font-medium`) for emphasis
- **Cursor**: Pointer to indicate clickability

---

## 🔧 Customization

### Add New Navigation Links

**In System Prompt (for Groq AI):**
```typescript
Available pages (use these exact paths for links):
- New Page (/v2/new-page): Description
```

**In Keyword Database:**
```typescript
'/v2/dashboard': {
  'keyword': 'Response with a [New Page](/v2/new-page) link.',
}
```

### Change Link Styling

Edit the `renderMarkdown` function in `HelpBot.tsx`:
```typescript
// Change color, weight, or add icons
return `<a href="${url}" class="text-purple-600 hover:underline font-bold internal-link" data-path="${url}">
  🔗 ${linkText}
</a>`
```

---

## 🚀 Benefits

1. **Faster Navigation**: Users click links instead of manually searching
2. **Better UX**: Seamless transition from help → action
3. **Reduced Friction**: Help bot guides users directly to solutions
4. **Context Preservation**: Bot closes after navigation, avoiding clutter
5. **Works with FREE Groq**: No cost, full interactivity

---

## 📊 User Flow

```
User asks question
    ↓
Bot responds with interactive links
    ↓
User clicks link
    ↓
Next.js router navigates instantly
    ↓
Help bot closes automatically
    ↓
User arrives at destination page
```

---

## 🐛 Troubleshooting

### Links not working?
- Check that `router` is imported from `next/navigation`
- Ensure `handleMessageClick` is attached to messages container
- Verify paths match your route structure

### Links not styled correctly?
- Check Tailwind classes are correct
- Verify CSS custom properties (e.g., `--v2-primary`) are defined
- Test in both light and dark mode

### AI not including links?
- Check system prompt has the markdown link examples
- Verify Groq is enabled (`USE_GROQ_HELP_BOT=true`)
- Test with keyword fallback to ensure it's not an AI-specific issue

---

## 🎓 Best Practices

1. **Always include context** with links ("Visit [Billing](/v2/billing) to...")
2. **Use descriptive link text** ("Agent List" not "click here")
3. **Test in dark mode** to ensure link colors are readable
4. **Keep paths consistent** with your actual routes
5. **Update both AI prompt and keyword database** when adding new pages

---

**Your help bot is now fully interactive! Users can navigate your entire app from within chat.** 🎉
