# Thinking Words

Display rotating status words while agents are processing, providing visual feedback that work is in progress. Words are loaded from a JSON dictionary and can be personalized based on user role.

## Architecture

```
lib/ui/
├── thinking-words-dictionary.json  ← Edit this to add/modify words (no code changes)
├── thinking-words-loader.ts        ← Singleton loader
└── thinking-words.ts               ← Public API
```

## Adding/Modifying Words

Edit `thinking-words-dictionary.json` directly:

```json
{
  "categories": {
    "business": {
      "description": "Business/SMB domain",
      "words": [
        "Forecasting",
        "Crunching numbers",
        "Your new word here"
      ]
    }
  },
  "roleMapping": {
    "sales": ["business", "communication", "friendly"]
  }
}
```

After editing, rebuild the app to pick up changes.

## Usage

### Role-Based Words (Recommended)

```typescript
import { createThinkingWordCyclerForRole } from '@/lib/ui/thinking-words';

// Create a cycler for a specific user role
const getNextWord = createThinkingWordCyclerForRole('sales');

// Each call returns the next word from general + sales-relevant categories
setInterval(() => {
  setStatus(getNextWord()); // "Thinking" → "Crunching numbers" → "On it" → ...
}, 2000);
```

### Random Word for Role

```typescript
import { getRandomThinkingWordForRole } from '@/lib/ui/thinking-words';

const status = getRandomThinkingWordForRole('finance'); // "Calculating ROI"
```

### Generic (All Words)

```typescript
import { getRandomThinkingWord, createThinkingWordCycler } from '@/lib/ui/thinking-words';

// Random word from all categories
const status = getRandomThinkingWord(); // "Analyzing"

// Sequential cycling through all words
const getNextWord = createThinkingWordCycler();
```

### Direct Loader Access

```typescript
import { getThinkingWordsLoader } from '@/lib/ui/thinking-words';

const loader = getThinkingWordsLoader();

// Get dictionary version
loader.getVersion(); // "1.0"

// Get all category names
loader.getCategoryNames(); // ["general", "business", ...]

// Get category description
loader.getCategoryDescription('business'); // "Business/SMB domain"

// Get word count
loader.getTotalWordCount(); // 90
loader.getCategoryWordCount('general'); // 16
```

## Word Categories

| Category | Description | Count |
|----------|-------------|-------|
| `general` | Universal words - always included for all roles | 16 |
| `business` | Business/SMB domain | 16 |
| `data_analysis` | Data & analysis operations | 15 |
| `planning` | Planning & strategy | 13 |
| `problem_solving` | Problem solving & debugging | 8 |
| `communication` | Communication & collaboration | 6 |
| `progress` | Progress indicators | 8 |
| `friendly` | Friendly/casual tone | 8 |

## Role → Category Mapping

Each role gets `general` (always) + role-specific categories:

| Role | Additional Categories |
|------|----------------------|
| `business_owner` | business, planning, progress |
| `manager` | planning, communication, progress |
| `consultant` | planning, problem_solving, data_analysis |
| `operations` | data_analysis, problem_solving, business |
| `sales` | business, communication, friendly |
| `marketing` | data_analysis, planning, friendly |
| `finance` | business, data_analysis |
| `other` | friendly, progress |

## React Example

```tsx
import { useState, useEffect } from 'react';
import { createThinkingWordCyclerForRole } from '@/lib/ui/thinking-words';
import type { UserRole } from '@/components/onboarding/hooks/useOnboarding';

interface Props {
  isProcessing: boolean;
  userRole?: UserRole;
}

function ThinkingIndicator({ isProcessing, userRole = 'other' }: Props) {
  const [word, setWord] = useState('Processing');

  useEffect(() => {
    if (!isProcessing) return;

    const getNext = createThinkingWordCyclerForRole(userRole);
    setWord(getNext());

    const interval = setInterval(() => setWord(getNext()), 2000);
    return () => clearInterval(interval);
  }, [isProcessing, userRole]);

  if (!isProcessing) return null;

  return <span className="animate-pulse">{word}...</span>;
}
```

## API Reference

### Types

```typescript
type ThinkingCategory =
  | 'general' | 'business' | 'data_analysis' | 'planning'
  | 'problem_solving' | 'communication' | 'progress' | 'friendly';

type UserRole =
  | 'business_owner' | 'manager' | 'consultant' | 'operations'
  | 'sales' | 'marketing' | 'finance' | 'other';
```

### Functions

| Function | Description |
|----------|-------------|
| `getRandomThinkingWord()` | Random word from all categories |
| `getRandomThinkingWordForRole(role)` | Random word for a specific role |
| `createThinkingWordCycler()` | Sequential cycler (all words) |
| `createThinkingWordCyclerForRole(role)` | Sequential cycler for a role |
| `getShuffledThinkingWords()` | Shuffled array (all words) |
| `getShuffledThinkingWordsForRole(role)` | Shuffled array for a role |
| `getWordsForRole(role)` | Get word array for a role |
| `getWordsForCategories(categories)` | Get words for specific categories |
| `getThinkingWordsLoader()` | Get the singleton loader instance |
| `resetThinkingWordsLoader()` | Reset the loader (for testing) |

### Loader Methods

| Method | Description |
|--------|-------------|
| `getVersion()` | Dictionary version string |
| `getCategoryNames()` | List of all category names |
| `getCategoryDescription(cat)` | Description for a category |
| `getWordsForCategory(cat)` | Words for a single category |
| `getAllWords()` | Flat array of all words |
| `getCategoriesForRole(role)` | Categories mapped to a role |
| `getWordsForRole(role)` | Words for a role (general + role-specific) |
| `getTotalWordCount()` | Total number of words |
| `getCategoryWordCount(cat)` | Word count for a category |

### Constants (Backward Compatibility)

| Constant | Description |
|----------|-------------|
| `THINKING_WORDS` | Flat readonly array (all words) |
| `THINKING_WORDS_BY_CATEGORY` | Words organized by category |
| `ROLE_CATEGORY_MAP` | Role → categories mapping |
