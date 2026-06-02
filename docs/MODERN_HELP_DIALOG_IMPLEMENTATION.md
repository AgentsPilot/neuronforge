# Modern Help Dialog Implementation

**Date**: May 29, 2026
**Status**: ✅ Implemented
**Component**: [ModernHelpDialog.tsx](/components/v2/ModernHelpDialog.tsx)

## Overview

The Modern Help Dialog is a complete redesign of the HelpBot system, featuring a dual-mode interface with advanced search capabilities, AI chat assistance, and seamless navigation integration.

---

## Key Features

### 1. **Dual Mode System**

The dialog supports two distinct modes that users can toggle between:

#### Search Mode
- **Quick Search**: Instant search across help articles, actions, and FAQs
- **Database-Backed**: Real-time search with relevance scoring
- **Debounced Input**: 300ms delay to reduce API calls
- **Grouped Results**: Organized by category (Actions, FAQs, Documentation)
- **Article Preview**: Full article body viewer with loading states

#### Chat Mode
- **AI-Powered Assistance**: Conversational help using Groq AI
- **Context-Aware**: Understands current page and provides relevant suggestions
- **Message History**: Maintains conversation context (last 5 messages)
- **Feedback System**: Thumbs up/down for response quality
- **Source Attribution**: Shows where responses come from (FAQ, Cache, Groq, AgentSearch)

### 2. **Modern UI/UX**

#### Visual Design
- **Backdrop Blur**: Semi-transparent backdrop with blur effect
- **Smooth Animations**: Fade-in, zoom-in, and slide transitions
- **Responsive Layout**: Adapts to different screen sizes
- **Keyboard Navigation**: Arrow keys, Enter, and Esc support
- **V2 Design Tokens**: Uses platform CSS variables for consistency

#### Components
```
┌─────────────────────────────────────────┐
│ 🔍 Search Input | Mode Toggle | ✕ Close │
├─────────────────────────────────────────┤
│                                         │
│  Search Mode:                           │
│  ┌─────────────────────────────────┐   │
│  │ Actions                         │   │
│  │ • Create New Agent              │   │
│  │ • View All Agents               │   │
│  ├─────────────────────────────────┤   │
│  │ FAQs                            │   │
│  │ • How do I create an agent?     │   │
│  │ • What are Pilot Credits?       │   │
│  ├─────────────────────────────────┤   │
│  │ Documentation                   │   │
│  │ • Getting Started Guide         │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Chat Mode:                             │
│  ┌─────────────────────────────────┐   │
│  │ 🤖 Hi! I'm your Dashboard       │   │
│  │    assistant...                 │   │
│  ├─────────────────────────────────┤   │
│  │ 👤 How do I add credits?        │   │
│  ├─────────────────────────────────┤   │
│  │ 🤖 Visit [Billing](/v2/billing) │   │
│  │    to add more credits...       │   │
│  │    👍 👎                         │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### 3. **Quick Actions**

Pre-defined navigation shortcuts:
- **Create New Agent** → `/v2/agents/new`
- **View All Agents** → `/v2/agent-list`
- **Manage Billing** → `/v2/billing`
- **View Analytics** → `/v2/analytics`

### 4. **Page-Aware Context**

Different help content for each page:

| Page | Title | Help Topics |
|------|-------|-------------|
| `/v2/dashboard` | Dashboard | Agent statistics, credit metrics, creating agents |
| `/v2/agent-list` | Agent List | Filtering agents, agent statuses, editing agents |
| `/v2/analytics` | Analytics | Cost breakdown, metrics, exporting data |
| `/v2/billing` | Billing | Adding credits, Pilot Credits, usage calculation |
| `/v2/settings` | Settings | API keys, integrations, profile updates |
| `/v2/agents/new` | Create Agent | Agent builder, required info, testing agents |

### 5. **Smart Features**

#### Markdown Rendering
- **Bold text**: `**text**` → **text**
- **Internal links**: `[Text](/path)` → Clickable navigation
- **External links**: `[Text](https://...)` → Opens in new tab

#### Interactive Navigation
- Click any internal link to navigate within the app
- Dialog auto-closes on navigation
- Maintains user context across pages

#### Search Relevance
- **API-Powered**: Uses `/api/help-bot-v2/search` endpoint
- **Context-Based**: Considers current page in search results
- **Ranked Results**: Returns top matches with relevance scores

#### Article System
- **Full-Text Search**: Searches article titles, descriptions, and body
- **Category Organization**: Groups articles by type
- **Snippet Preview**: Shows relevant excerpt in search results
- **Full Body Viewer**: Click to see complete article content

---

## Technical Architecture

### Component Structure

```typescript
interface ModernHelpDialogProps {
  isOpen: boolean
  onClose: () => void
}

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
```

### State Management

```typescript
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
```

### API Endpoints

#### Search Articles
```typescript
GET /api/help-bot-v2/search?q={query}&context={pathname}

Response:
{
  results: [
    {
      id: "article-1",
      title: "Getting Started",
      snippet: "Learn how to create your first agent...",
      url: "/docs/getting-started",
      relevanceScore: 0.95,
      category: "Documentation"
    }
  ]
}
```

#### Get Article Body
```typescript
GET /api/help-bot-v2/article/{id}

Response:
{
  body: "Full article content in markdown format..."
}
```

#### AI Chat
```typescript
POST /api/help-bot-v2

Request:
{
  question: "How do I add credits?",
  context: {
    path: "/v2/dashboard",
    title: "Dashboard"
  },
  conversationHistory: [...previousMessages]
}

Response:
{
  answer: "Visit [Billing](/v2/billing) to add credits...",
  source: "Groq",
  relatedDocs: [...]
}
```

#### Submit Feedback
```typescript
POST /api/help-bot-v2/feedback

Request:
{
  cacheId: "cache-123",
  feedback: "up" | "down"
}
```

### Key Functions

#### Search Debouncing
```typescript
useEffect(() => {
  if (mode !== 'search') return

  const timer = setTimeout(() => {
    fetchHelpArticles(searchQuery)
  }, 300) // 300ms debounce

  return () => clearTimeout(timer)
}, [searchQuery, mode, fetchHelpArticles])
```

#### Markdown Rendering
```typescript
function renderMarkdown(text: string) {
  let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, linkText, url) => {
      if (url.startsWith('/'))
        return `<a class="internal-link" data-path="${url}">${linkText}</a>`
      else if (url.startsWith('http'))
        return `<a href="${url}" target="_blank">${linkText}</a>`
      return match
    }
  )
  return processed
}
```

#### Navigation Handling
```typescript
const handleMessageClick = (e: React.MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.classList.contains('internal-link')) {
    const path = target.getAttribute('data-path')
    if (path) {
      router.push(path)
      onClose()
    }
  }
}
```

---

## Integration Guide

### 1. Add to Layout/Page

```typescript
'use client'

import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'
import { useState } from 'react'

export default function Layout() {
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <>
      {/* Help Button */}
      <button
        onClick={() => setHelpOpen(true)}
        className="fixed bottom-4 right-4 p-3 bg-[var(--v2-primary)] text-white rounded-full shadow-lg hover:scale-110 transition-transform z-40"
      >
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* Help Dialog */}
      <ModernHelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

      {children}
    </>
  )
}
```

### 2. Keyboard Shortcut (Optional)

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd/Ctrl + K to open help
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setHelpOpen(true)
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [])
```

### 3. Add Page Context

Update `PAGE_CONTEXTS` in `ModernHelpDialog.tsx`:

```typescript
const PAGE_CONTEXTS: Record<string, { title: string; description: string; helpTopics: string[] }> = {
  '/your/new/page': {
    title: 'Your Page Title',
    description: 'Brief description of the page',
    helpTopics: [
      'How do I do X?',
      'What does Y mean?',
      'How can I configure Z?'
    ]
  }
}
```

---

## Styling

### CSS Variables Used

```css
--v2-surface           /* Dialog background */
--v2-surface-hover     /* Hover state background */
--v2-border           /* Border color */
--v2-primary          /* Primary accent color */
--v2-secondary        /* Secondary accent color */
--v2-text-primary     /* Primary text color */
--v2-text-secondary   /* Secondary text color */
--v2-text-muted       /* Muted text color */
--v2-radius-card      /* Border radius for dialog */
--v2-radius-button    /* Border radius for buttons */
```

### Custom Animations

```css
/* Fade in backdrop */
.animate-in.fade-in {
  animation: fadeIn 200ms ease-out;
}

/* Zoom in and slide dialog */
.animate-in.zoom-in-95.slide-in-from-top-4 {
  animation: zoomSlideIn 200ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes zoomSlideIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-1rem);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close dialog |
| `Enter` | Send message (chat mode) / Select item (search mode) |
| `↑` / `↓` | Navigate results (search mode) |
| `Cmd/Ctrl + K` | Open dialog (if implemented) |

---

## Performance Optimizations

### 1. Debounced Search
- 300ms delay prevents excessive API calls
- Cancels pending requests when query changes

### 2. Conditional Rendering
```typescript
if (!isOpen) return null // Don't render when closed
```

### 3. Lazy Loading
- Article body loaded only when selected
- Search results fetched on-demand

### 4. Memoized Grouping
```typescript
const groupedItems = useMemo(() =>
  filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {} as Record<string, typeof allItems>)
, [filteredItems])
```

---

## Comparison: Old vs. New

| Feature | Old HelpBot | New ModernHelpDialog |
|---------|-------------|----------------------|
| **UI Style** | Fixed sidebar | Centered modal dialog |
| **Modes** | Chat only | Search + Chat dual mode |
| **Search** | Basic keyword matching | Advanced relevance-based search |
| **Navigation** | Manual links | Quick actions + smart linking |
| **Articles** | Hardcoded FAQs | Database-backed article system |
| **Feedback** | None | Thumbs up/down rating |
| **Mobile** | Basic responsive | Fully optimized |
| **Animations** | None | Smooth transitions |
| **Keyboard** | Limited | Full keyboard navigation |
| **Context** | Static | Page-aware dynamic content |

---

## Migration Plan

### Phase 1: Parallel Deployment (Current)
- ✅ New `ModernHelpDialog` component created
- ✅ API endpoints implemented
- ⬜ Add to key pages alongside old HelpBot
- ⬜ Collect user feedback

### Phase 2: Feature Parity
- ⬜ Migrate all old HelpBot features to new dialog
- ⬜ Ensure admin configuration compatibility
- ⬜ Add missing page contexts

### Phase 3: Full Replacement
- ⬜ Replace all old HelpBot instances
- ⬜ Update documentation
- ⬜ Remove old HelpBot component
- ⬜ Deprecate old API endpoints

### Phase 4: Enhancements
- ⬜ Add more quick actions
- ⬜ Expand article database
- ⬜ Implement search analytics
- ⬜ Add video tutorial support

---

## Database Schema

### Help Articles Table

```sql
CREATE TABLE help_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  body TEXT NOT NULL,
  keywords TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  published BOOLEAN DEFAULT true,
  view_count INTEGER DEFAULT 0,
  helpful_count INTEGER DEFAULT 0,
  unhelpful_count INTEGER DEFAULT 0
);

CREATE INDEX idx_help_articles_category ON help_articles(category);
CREATE INDEX idx_help_articles_keywords ON help_articles USING GIN(keywords);
CREATE INDEX idx_help_articles_published ON help_articles(published);
```

### Search Function

```sql
CREATE OR REPLACE FUNCTION search_help_articles(
  search_query TEXT,
  context_path TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  snippet TEXT,
  url TEXT,
  relevance_score FLOAT,
  category TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ha.id,
    ha.title,
    LEFT(ha.description, 200) as snippet,
    '/help/' || ha.id as url,
    ts_rank(
      to_tsvector('english', ha.title || ' ' || ha.description || ' ' || ha.body),
      plainto_tsquery('english', search_query)
    ) as relevance_score,
    ha.category
  FROM help_articles ha
  WHERE
    published = true
    AND (
      to_tsvector('english', ha.title || ' ' || ha.description || ' ' || ha.body)
      @@ plainto_tsquery('english', search_query)
    )
  ORDER BY relevance_score DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql;
```

---

## Testing Checklist

### Unit Tests
- [ ] Markdown rendering function
- [ ] Message grouping logic
- [ ] Search debouncing
- [ ] Keyboard navigation handlers

### Integration Tests
- [ ] Search API endpoint
- [ ] Article fetch API
- [ ] Chat API endpoint
- [ ] Feedback submission

### E2E Tests
- [ ] Open/close dialog
- [ ] Switch between modes
- [ ] Search for articles
- [ ] Click quick actions
- [ ] Send chat message
- [ ] Navigate via internal links
- [ ] Submit feedback
- [ ] Keyboard shortcuts

### Accessibility
- [ ] Screen reader compatibility
- [ ] Keyboard-only navigation
- [ ] Focus management
- [ ] ARIA labels
- [ ] Color contrast ratios

---

## Troubleshooting

### Issue: Search not returning results

**Symptom**: Search query returns empty array

**Solutions**:
1. Check API endpoint is accessible: `curl /api/help-bot-v2/search?q=test`
2. Verify database has articles: `SELECT COUNT(*) FROM help_articles WHERE published = true`
3. Check search query encoding: Ensure special characters are properly encoded
4. Verify debounce timer: Search waits 300ms after typing stops

### Issue: Chat mode not responding

**Symptom**: No AI response after sending message

**Solutions**:
1. Check Groq API key in environment variables: `GROQ_API_KEY`
2. Verify API endpoint: `POST /api/help-bot-v2` with test payload
3. Check browser console for errors
4. Verify conversation history format is correct

### Issue: Links not working

**Symptom**: Clicking internal links doesn't navigate

**Solutions**:
1. Verify `handleMessageClick` is attached to message container
2. Check link has `internal-link` class and `data-path` attribute
3. Ensure `router.push()` is working correctly
4. Check if dialog is closing after navigation

### Issue: Dialog not closing

**Symptom**: Dialog remains open after clicking backdrop

**Solutions**:
1. Verify `onClick={onClose}` is on backdrop div
2. Check `e.stopPropagation()` is on dialog container
3. Ensure `onClose` prop is passed correctly from parent

---

## Future Enhancements

### Short Term
- [ ] **Command Palette**: Cmd+K to open with search pre-focused
- [ ] **Recent Searches**: Show last 5 searches
- [ ] **Suggested Questions**: AI-generated suggestions based on page
- [ ] **Search Filters**: Filter by category, recency, popularity

### Medium Term
- [ ] **Video Tutorials**: Embed video help in articles
- [ ] **Interactive Tours**: Guided walkthroughs for features
- [ ] **Multi-language**: i18n support for help content
- [ ] **Search Analytics**: Track popular queries to improve content

### Long Term
- [ ] **AI Training**: Fine-tune on user feedback
- [ ] **Community Answers**: User-contributed help articles
- [ ] **Voice Input**: Speak questions instead of typing
- [ ] **Smart Suggestions**: Proactive help based on user behavior

---

## Support & Maintenance

### Documentation
- **Main Component**: [ModernHelpDialog.tsx](/components/v2/ModernHelpDialog.tsx)
- **API Routes**:
  - [help-bot-v2/route.ts](/app/api/help-bot-v2/route.ts)
  - [help-bot-v2/search/route.ts](/app/api/help-bot-v2/search/route.ts)
  - [help-bot-v2/article/[id]/route.ts](/app/api/help-bot-v2/article/[id]/route.ts)
  - [help-bot-v2/feedback/route.ts](/app/api/help-bot-v2/feedback/route.ts)

### Related Documentation
- [HELPBOT_ADMIN_CONFIGURATION_IMPLEMENTATION.md](/docs/HELPBOT_ADMIN_CONFIGURATION_IMPLEMENTATION.md)
- [HELP_BOT_FEATURES_SUMMARY.md](/docs/HELP_BOT_FEATURES_SUMMARY.md)
- [HOW_GROQ_HELPBOT_WORKS.md](/docs/HOW_GROQ_HELPBOT_WORKS.md)

### Contact
For issues or questions about the Modern Help Dialog:
1. Check this documentation
2. Review component source code
3. Check API endpoint logs
4. Contact development team

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-29 | Initial implementation | Created ModernHelpDialog with dual-mode system, search, chat, and quick actions |
| 2026-05-29 | Documentation created | Comprehensive implementation guide and migration plan |

---

**Status**: ✅ Ready for deployment
**Next Step**: Begin Phase 1 parallel deployment on key pages
